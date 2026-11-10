'use strict';

// 本地曲目歌词补全：读 source/_data/playlist.yml，逐首去 lrclib 抓同步歌词（LRC）。
//
// 用法：
//   npm run lyrics                       给还没有 lrc 的本地曲目补歌词
//   npm run lyrics -- --dry-run          只预览匹配结果，不写任何文件
//   npm run lyrics -- --force            已有 lrc 的曲目也重新抓一遍
//   npm run lyrics -- --pick "曲名=id"   手工指定某首用哪条候选（用于多条候选待定的情况）
//
// 匹配规则：
//   1. GET https://lrclib.net/api/search，标题/歌手直接用 playlist.yml 里的 title/artist；
//   2. 只接受 syncedLyrics 非空的候选（plainLyrics 没有时间轴，不可用），排除 instrumental: true；
//   3. 候选 duration 与音频真实时长差值 ≤ 3 秒 —— 真实时长由本脚本解析 MP3 帧头算出，
//      不读 ID3 的 TLEN（这些文件里没有 TLEN），也不调用外部依赖；
//   4. 多条候选时用专辑名收敛：先要求 albumName 与音频 ID3 的 TALB 完全一致（忽略大小写/空白），
//      再退化为「去掉括号后缀」后一致（用于 (Deluxe Edition) / (Original Soundtrack) 这类差异）；
//   5. 仍有多条时，只有「与真实时长最接近的唯一一条」才会被采用；若并列则视为待定，不写 lrc，
//      把候选（id、时长、专辑、差值）列出来等人拍板；
//   6. 一条合格的都没有同样保持原样，音乐页继续显示「纯音乐，请欣赏」，不伪造歌词。
//
// 写文件：
//   - 歌词写到 source/music/lrc/<与音频同名的 basename>.lrc，UTF-8 无 BOM，保留 lrclib 原始时间轴；
//   - playlist.yml 只给成功的曲目在 audio 下方补一行 lrc: "music/lrc/xxx.lrc"，失败条目不动。
//
// 请求间隔 1.2s，遇到 429 退避重试，重试仍失败或网络错误时跳过该曲继续下一首。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'source', '_data', 'playlist.yml');
const API = 'https://lrclib.net/api/search';
const UA = 'Fx-blog-lyrics/1.0 (static blog build script)';
const MAX_DELTA = 3;
const REQUEST_GAP = 1200;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const force = argv.includes('--force');
const manualPicks = {};
argv.forEach((a, i) => {
  if (a !== '--pick' || !argv[i + 1]) return;
  const raw = argv[i + 1];
  const eq = raw.lastIndexOf('=');
  if (eq > 0) manualPicks[raw.slice(0, eq).trim()] = Number(raw.slice(eq + 1));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unquote(v) {
  let s = String(v == null ? '' : v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}

// ---------------------------------------------------------------- playlist.yml

function readPlaylist() {
  const text = fs.readFileSync(DATA_FILE, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  lines.forEach((line, i) => {
    const head = /^(\s*)-\s+([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (head) {
      cur = { fields: {}, lines: {}, indent: head[1] };
      blocks.push(cur);
      cur.fields[head[2]] = unquote(head[3]);
      cur.lines[head[2]] = i;
      return;
    }
    const field = /^(\s*)([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (field && cur) {
      cur.fields[field[2]] = unquote(field[3]);
      cur.lines[field[2]] = i;
    }
  });
  return { eol, lines, blocks };
}

// ------------------------------------------------------------------ MP3 解析

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function id3v2Size(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  return 10 + size + ((buf[5] & 0x10) ? 10 : 0);
}

function syncAt(buf, off, version) {
  if (off + 4 > buf.length) return false;
  if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) return false;
  const v = (buf[off + 1] >> 3) & 3;
  const layer = (buf[off + 1] >> 1) & 3;
  const si = (buf[off + 2] >> 2) & 3;
  return v === version && layer === 1 && si !== 3;
}

function frameInfo(buf, off) {
  if (off + 4 > buf.length) return null;
  if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[off + 1] >> 3) & 3;
  const layer = (buf[off + 1] >> 1) & 3;
  if (version === 1 || layer !== 1) return null;
  const bi = (buf[off + 2] >> 4) & 0xf;
  const si = (buf[off + 2] >> 2) & 3;
  if (bi === 0 || bi === 15 || si === 3) return null;
  const bitrate = (version === 3 ? BITRATES[1] : BITRATES[2])[bi];
  const sampleRate = SAMPLE_RATES[version][si];
  const padding = (buf[off + 2] >> 1) & 1;
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + padding;
  if (!length || length < 24) return null;
  if (off + length + 4 <= buf.length && !syncAt(buf, off + length, version)) return null;
  return { length, samples, sampleRate };
}

// 用下一帧同步字校验逐帧累加，得到真实时长（秒）
function mp3Duration(buf) {
  let off = id3v2Size(buf);
  while (off + 4 < buf.length && !frameInfo(buf, off)) off++;
  if (!frameInfo(buf, off)) throw new Error('未找到 MP3 帧');
  let seconds = 0;
  let frames = 0;
  let idle = 0;
  while (off + 4 <= buf.length) {
    const info = frameInfo(buf, off);
    if (!info) {
      off++;
      idle++;
      if (idle > 8192 && frames > 0) break;
      continue;
    }
    idle = 0;
    seconds += info.samples / info.sampleRate;
    frames++;
    off += info.length;
  }
  return { seconds, frames };
}

function id3Text(buf, wanted) {
  if (buf.toString('latin1', 0, 3) !== 'ID3') return '';
  const ver = buf[3];
  const end = Math.min(10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)), buf.length);
  let off = 10;
  if (buf[5] & 0x40) off += 4;
  while (off + 10 <= end) {
    const id = buf.toString('latin1', off, off + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = ver === 4
      ? ((buf[off + 4] & 0x7f) << 21) | ((buf[off + 5] & 0x7f) << 14) | ((buf[off + 6] & 0x7f) << 7) | (buf[off + 7] & 0x7f)
      : buf.readUInt32BE(off + 4);
    if (size <= 0 || off + 10 + size > end) break;
    if (id === wanted) {
      const body = buf.slice(off + 10, off + 10 + size);
      const enc = body[0];
      const raw = body.slice(1);
      if (enc === 1 || enc === 2) return raw.toString('utf16le').replace(/^\uFEFF/, '').replace(/\u0000+$/, '').trim();
      if (enc === 3) return raw.toString('utf8').replace(/\u0000+$/, '').trim();
      return raw.toString('latin1').replace(/\u0000+$/, '').trim();
    }
    off += 10 + size;
  }
  return '';
}

// ------------------------------------------------------------------ 匹配

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// 专辑名比较：去掉括号里的版本说明（Deluxe Edition / Original Soundtrack 等），
// 再抹平标点差异（"Awesome Mix, Vol. 1" 与 "Awesome Mix Vol. 1" 视为同名）
const albumBase = (s) => norm(s)
  .replace(/[([（【].*?[)\]）】]/g, ' ')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function search(title, artist) {
  const url = API + '?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist);
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
      if (res.status === 429) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { error: 'HTTP ' + res.status };
      const data = await res.json();
      return { list: Array.isArray(data) ? data : [] };
    } catch (err) {
      if (attempt === 2) return { error: String(err.message || err) };
      await sleep(2000);
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: 'HTTP 429（退避重试后仍被限流）' };
}

function selectCandidate(list, realDuration, album, artist) {
  let valid = list.filter((c) => typeof c.syncedLyrics === 'string' && c.syncedLyrics.trim()
    && c.instrumental !== true
    && typeof c.duration === 'number'
    && Math.abs(c.duration - realDuration) <= MAX_DELTA);
  if (!valid.length) return { status: 'none', candidates: valid };

  // 歌手必须与 playlist 一致，避免合唱/翻唱版本混进来；完全匹配不到时再退回全部
  const sameArtist = valid.filter((c) => norm(c.artistName) === norm(artist));
  if (sameArtist.length) valid = sameArtist;

  let pool = valid;
  let by = '无专辑约束';
  const exact = pool.filter((c) => c.albumName && norm(c.albumName) === norm(album));
  if (exact.length) {
    pool = exact;
    by = '专辑名完全一致';
  } else if (album) {
    const base = pool.filter((c) => c.albumName && albumBase(c.albumName) === albumBase(album));
    if (base.length) {
      pool = base;
      by = '专辑名去括号后缀后一致';
    }
  }

  const delta = (c) => Math.abs(c.duration - realDuration);
  const sorted = pool.slice().sort((a, b) => delta(a) - delta(b));
  const best = delta(sorted[0]);
  const tied = sorted.filter((c) => delta(c) - best < 0.05);
  if (tied.length === 1) {
    return { status: 'ok', chosen: tied[0], by: tied.length === 1 && pool.length === 1 ? by : by + ' + 时长差最小', candidates: sorted };
  }
  return { status: 'ambiguous', candidates: sorted };
}

// ------------------------------------------------------------------ 主流程

(async () => {
  const playlist = readPlaylist();
  const inserts = [];
  const report = [];
  let written = 0;

  for (const block of playlist.blocks) {
    const f = block.fields;
    const audio = f.audio;
    if (!audio) continue;

    if (/^https?:\/\//i.test(audio)) {
      report.push([f.title, '—', 0, '远程曲目，跳过（无法本地解析时长）']);
      continue;
    }

    const audioAbs = path.join(ROOT, 'source', audio);
    const base = path.basename(audio, path.extname(audio));
    const lrcRel = 'music/lrc/' + base + '.lrc';
    const lrcAbs = path.join(ROOT, 'source', lrcRel);

    if (!force && f.lrc && fs.existsSync(lrcAbs)) {
      report.push([f.title, '—', 0, '已有歌词，跳过']);
      continue;
    }
    if (!fs.existsSync(audioAbs)) {
      report.push([f.title, '—', 0, '音频文件不存在：' + audio]);
      continue;
    }

    const buf = fs.readFileSync(audioAbs);
    let realDuration = 0;
    try {
      realDuration = mp3Duration(buf).seconds;
    } catch (err) {
      report.push([f.title, '—', 0, '解析时长失败：' + err.message]);
      continue;
    }
    const album = id3Text(buf, 'TALB');

    const res = await search(f.title, f.artist);
    if (res.error) {
      report.push([f.title, realDuration.toFixed(2) + 's', 0, '请求失败，跳过：' + res.error]);
      await sleep(REQUEST_GAP);
      continue;
    }

    let result;
    if (manualPicks[f.title]) {
      const hit = res.list.find((c) => c.id === manualPicks[f.title]);
      result = hit && hit.syncedLyrics && hit.syncedLyrics.trim()
        ? { status: 'ok', chosen: hit, by: '--pick 手工指定', candidates: [hit] }
        : { status: 'none', candidates: [] };
    } else {
      result = selectCandidate(res.list, realDuration, album, f.artist);
    }

    if (result.status === 'ok') {
      const c = result.chosen;
      const d = c.duration - realDuration;
      if (!dryRun) {
        let text = String(c.syncedLyrics).replace(/\r\n?/g, '\n');
        if (!text.endsWith('\n')) text += '\n';
        fs.mkdirSync(path.dirname(lrcAbs), { recursive: true });
        fs.writeFileSync(lrcAbs, text, 'utf8');
        written++;
        if (!f.lrc) inserts.push({ after: block.lines.audio, text: block.indent + '  lrc: "' + lrcRel + '"' });
      }
      report.push([f.title, realDuration.toFixed(2) + 's', result.candidates.length,
        (dryRun ? '[预览] ' : '') + 'id=' + c.id + ' | ' + c.duration + 's (Δ' + d.toFixed(2) + ') | ' + (c.albumName || '—') + ' | ' + result.by]);
    } else if (result.status === 'ambiguous') {
      const list = result.candidates.map((c) => 'id=' + c.id + ' ' + c.duration + 's (Δ' + (c.duration - realDuration).toFixed(2) + ') 《' + (c.albumName || '—') + '》').join('；');
      report.push([f.title, realDuration.toFixed(2) + 's', result.candidates.length, '多个候选待定，未写 lrc：' + list]);
    } else {
      report.push([f.title, realDuration.toFixed(2) + 's', 0, '未找到（无 synced 且非纯音乐的候选）']);
    }
    await sleep(REQUEST_GAP);
  }

  if (!dryRun && inserts.length) {
    const lines = playlist.lines.slice();
    inserts.sort((a, b) => b.after - a.after).forEach((ins) => lines.splice(ins.after + 1, 0, ins.text));
    let text = lines.join(playlist.eol);
    if (text && !text.endsWith(playlist.eol)) text += playlist.eol;
    fs.writeFileSync(DATA_FILE, text, 'utf8');
  }

  console.log('\n曲目 | 真实时长 | 候选数 | 结果');
  console.log('--- | --- | --- | ---');
  report.forEach((row) => console.log(row.join(' | ')));
  if (dryRun) console.log('\n[dry-run] 未写入任何文件');
  else console.log('\n写入 ' + written + ' 个 lrc 文件，补充 ' + inserts.length + ' 条 lrc 字段');
})().catch((err) => {
  console.error('[lyrics] 意外错误：', err);
  process.exit(1);
});
