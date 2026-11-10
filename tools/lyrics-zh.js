'use strict';

// 构建期补全：给已有原词的非中文曲目抓「中文译文」和「曲目信息」（网易云音乐）。
//
// 用法：
//   npm run lyrics:zh                    处理缺少译文/曲目信息的本地曲目
//   npm run lyrics:zh -- --dry-run       只打印匹配与对齐结果，不写任何文件
//   npm run lyrics:zh -- --force         已处理过的也重新抓
//   npm run lyrics:zh -- --pick "曲名=歌曲id"  多候选并列时手工指定
//
// 数据来源（非官方公开接口，非文档化，随时可能 403 / 返回空 / 改结构）：
//   - 搜索  GET https://music.163.com/api/search/get/web?s=<曲名 歌手>&type=1
//   - 歌词  GET https://music.163.com/api/song/lyric?id=<id>&lv=1&tv=1
//            lrc.lyric = 原词（头部若干行常混有「作词 : xxx」这类信息行）
//            tlyric.lyric = 中文译文
//   - 详情  GET https://music.163.com/api/song/detail?ids=[<id>]  → album.name
//   每个请求都带 Referer / User-Agent，判空判错；失败只跳过当前曲目、继续下一首。
//   请求间隔 1.2s，429 退避重试，脚本可重复运行（已有数据跳过，--force 才覆盖）。
//
// 匹配规则（与 tools/lyrics.js 同一套，另加歌名收敛）：
//   1. 真实时长由本脚本解析 MP3 帧头算出，候选 duration 与它差值 ≤ 3 秒才算命中；
//   2. 歌手须与 playlist.yml 一致（归一化比较）；
//   3. 歌名归一化后须一致（候选前面的同名作品优先，避免 (Live)/(Extended) 混入）；
//   4. 多条时用专辑收敛：ID3 TALB 与候选专辑先全等、再去括号/抹平标点后相等；
//   5. 仍多条则只接受「时长差最小且唯一」的一条，否则列候选并跳过，不猜。
//
// 译文落盘规则：
//   - 译文的每条时间戳都改写为「本仓库原词文件里同一句」的时间戳，保证与页面展示的原词逐行对齐；
//   - 存成与音频同名的独立文件 <basename>.zh.lrc（不把两种语言混进同一个 .lrc）；
//   - 原词里找不到对应句子的译文行直接丢弃（宁缺勿错），不机翻、不凑数；
//   - 没有译文时只补曲目信息，不写空文件。
//
// 写 playlist.yml：
//   - 成功的曲目补 zhlrc: "music/lrc/<basename>.zh.lrc" 与 credits:（lyricist/composer/arranger/album），
//     空字段不写；已有值在 --force 时覆盖。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'source', '_data', 'playlist.yml');
const API = 'https://music.163.com/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://music.163.com/', Accept: 'application/json' };
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
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normLine = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const albumBase = (s) => norm(s)
  .replace(/[([（【].*?[)\]）】]/g, ' ')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function unquote(v) {
  let s = String(v == null ? '' : v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}

function quoteYaml(v) {
  return '"' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim() + '"';
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
      cur = { fields: {}, lines: {}, indent: head[1], start: i };
      blocks.push(cur);
      cur.fields[head[2]] = unquote(head[3]);
      cur.lines[head[2]] = i;
      cur.end = i;
      return;
    }
    // 只把缩进 ≤ 2 的行当作曲目字段；credits: 下的嵌套键是 4 空格，不参与解析
    const field = /^(\s{0,2})([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (field && cur) {
      cur.fields[field[2]] = unquote(field[3]);
      cur.lines[field[2]] = i;
      cur.end = i;
    }
  });
  // 块的结束行要包含 credits: 下的嵌套行，否则重跑时删不掉旧值（会重复追加）
  blocks.forEach((b, i) => {
    const next = blocks[i + 1] ? blocks[i + 1].start - 1 : lines.length - 1;
    let end = next;
    while (end > b.start && !lines[end].trim()) end--;
    b.end = end;
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
  return seconds;
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

// ---------------------------------------------------------------- LRC 解析

const CREDIT_RE = /^(作词|作曲|编曲|制作人|专辑|演唱|混音|母带|录音|监制|出品|统筹|词|曲)\s*[:：]\s*(.+)$/;

// 保留时间戳原文（ts），译文要沿用原词的时间戳写回，才能逐行对齐
function parseLrc(text) {
  const lines = [];
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const times = [];
    const stamps = [];
    let m;
    while ((m = re.exec(trimmed))) {
      const frac = m[3] ? parseFloat('0.' + m[3]) : 0;
      times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      stamps.push(m[0]);
    }
    if (!times.length) return;
    const content = trimmed.replace(/\[[^\]]*\]/g, '').trim();
    times.forEach((t, i) => lines.push({ time: t, ts: stamps[i], text: content }));
  });
  return lines;
}

// 网易云把「作词 : xxx」也塞进 lrc 头部，这些行要抽成曲目信息并从歌词里剔除
function splitCredits(lines) {
  const credits = {};
  const kept = lines.filter((line) => {
    const m = CREDIT_RE.exec(line.text);
    if (!m) return true;
    const key = m[1];
    const val = m[2].trim();
    if (!val) return false;
    if (key === '作词' || key === '词') credits.lyricist = credits.lyricist || val;
    else if (key === '作曲' || key === '曲') credits.composer = credits.composer || val;
    else if (key === '编曲') credits.arranger = credits.arranger || val;
    return false;
  });
  return { credits, lines: kept };
}

function zhMapOf(tlyricLines) {
  const map = new Map();
  tlyricLines.forEach((line) => {
    if (!line.text) return;
    const key = line.time.toFixed(2);
    if (!map.has(key)) map.set(key, line.text);
  });
  return map;
}

const tokenSet = (s) => {
  const set = new Set();
  String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).forEach((w) => { if (w) set.add(w); });
  return set;
};

// 原词与网易云原词逐句相似度（只看英文词集合的重合）
function lineSim(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit++; });
  return hit / Math.max(A.size, B.size);
}

// 单调对齐（动态规划）：两份歌词是同一首的不同抄本，行数不一定相同、用词也可能有出入，
// 不能按相同文本硬配（会出现「第一段副歌配到第二段」）。这里保持顺序，允许插空，
// 逐行用词重合度打分，再按对齐结果把网易译文搬到原词的行上。
function alignTranslation(originalLines, neLines, neZhMap) {
  const o = originalLines.filter((l) => l.text);
  const n = neLines.filter((l) => l.text);
  const N = o.length;
  const M = n.length;
  const GAP = -0.4;
  const dp = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
  const back = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0)); // 1=对角 2=跳过原词 3=跳过网易行
  for (let i = 1; i <= N; i++) { dp[i][0] = i * GAP; back[i][0] = 2; }
  for (let j = 1; j <= M; j++) { dp[0][j] = j * GAP; back[0][j] = 3; }
  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      const s = lineSim(o[i - 1].text, n[j - 1].text);
      const diag = dp[i - 1][j - 1] + (s >= 0.45 ? s : GAP);
      const up = dp[i - 1][j] + GAP;
      const left = dp[i][j - 1] + GAP;
      let best = diag;
      let b = 1;
      if (up > best) { best = up; b = 2; }
      if (left > best) { best = left; b = 3; }
      dp[i][j] = best;
      back[i][j] = b;
    }
  }
  const pairs = [];
  let i = N;
  let j = M;
  while (i > 0 && j > 0) {
    const b = back[i][j];
    if (b === 1) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (b === 2) i--;
    else j--;
  }
  pairs.reverse();

  const out = [];
  pairs.forEach(([oi, ni]) => {
    const a = o[oi];
    const b = n[ni];
    const gap = Math.abs(b.time - a.time);
    // 兜底：词完全不重合且时间差很大，多半是错配（译文的开头信息行等），直接丢弃
    if (lineSim(a.text, b.text) === 0 && gap > 6) return;
    const zh = neZhMap.get(b.time.toFixed(2));
    if (!zh) return;
    out.push({ ts: a.ts, time: a.time, text: zh });
  });
  return out;
}

// ------------------------------------------------------------------ 网络

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (res.status === 429) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { error: 'HTTP ' + res.status };
      const text = await res.text();
      if (!text.trim()) return { error: '响应为空' };
      try {
        return { json: JSON.parse(text) };
      } catch (err) {
        return { error: '响应不是 JSON：' + text.slice(0, 60) };
      }
    } catch (err) {
      if (attempt === 2) return { error: String((err && err.message) || err) };
      await sleep(2000);
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: 'HTTP 429（退避重试后仍被限流）' };
}

async function search(title, artist) {
  const q = encodeURIComponent(title + ' ' + artist);
  const res = await getJson(API + '/search/get/web?s=' + q + '&type=1&limit=20&offset=0&total=true');
  if (res.error) return res;
  const songs = (res.json.result && res.json.result.songs) || [];
  return { songs: Array.isArray(songs) ? songs : [] };
}

function selectCandidate(songs, realDuration, album, artist, title) {
  let valid = songs.filter((s) => typeof s.duration === 'number'
    && Math.abs(s.duration / 1000 - realDuration) <= MAX_DELTA);
  if (!valid.length) return { status: 'none', candidates: [] };

  const sameArtist = valid.filter((s) => s.artists && s.artists.some((a) => norm(a.name) === norm(artist)));
  if (sameArtist.length) valid = sameArtist;

  const sameTitle = valid.filter((s) => norm(s.name) === norm(title));
  if (sameTitle.length) valid = sameTitle;

  let pool = valid;
  let by = '时长±3s';
  const exact = pool.filter((s) => s.album && norm(s.album.name) === norm(album));
  if (album && exact.length) {
    pool = exact;
    by = '专辑名完全一致';
  } else if (album) {
    const base = pool.filter((s) => s.album && albumBase(s.album.name) === albumBase(album));
    if (base.length) {
      pool = base;
      by = '专辑名去括号后缀后一致';
    }
  }

  const delta = (s) => Math.abs(s.duration / 1000 - realDuration);
  const sorted = pool.slice().sort((a, b) => delta(a) - delta(b));
  const best = delta(sorted[0]);
  const tied = sorted.filter((s) => delta(s) - best < 0.05);
  if (tied.length === 1) {
    return { status: 'ok', chosen: tied[0], by: by + (pool.length > 1 ? ' + 时长差最小' : ''), candidates: sorted };
  }
  return { status: 'ambiguous', candidates: sorted };
}

// ------------------------------------------------------------------ 主流程

(async () => {
  const playlist = readPlaylist();
  const report = [];
  let zhWritten = 0;
  let zhSkipped = 0;

  for (const block of playlist.blocks) {
    const f = block.fields;
    const audio = f.audio;
    if (!audio) continue;

    if (/^https?:\/\//i.test(audio)) {
      report.push({ title: f.title, result: '远程曲目，跳过（无法本地解析时长）' });
      continue;
    }
    // 中文原创曲目不做译文（译中文没有意义），但仍然抓曲目信息
    const needsZh = !/[\u4e00-\u9fa5]/.test(f.title);

    const audioAbs = path.join(ROOT, 'source', audio);
    const base = path.basename(audio, path.extname(audio));
    const lrcAbs = path.join(ROOT, 'source', f.lrc || ('music/lrc/' + base + '.lrc'));
    const zhRel = 'music/lrc/' + base + '.zh.lrc';
    const zhAbs = path.join(ROOT, 'source', zhRel);

    const hasZhFile = fs.existsSync(zhAbs);
    // credits 是嵌套结构，readPlaylist 只看顶层；用文本扫描判断是否已有
    const blockText = playlist.lines.slice(block.start, block.end + 1).join('\n');
    const hasCreditsText = /^\s{2}credits:\s*$/m.test(blockText);
    // 幂等：credits 一旦写入即视为该曲已处理（译文有无由网易云是否提供决定，
    // 无译文的曲目再跑也不会多出内容）。--force 才重新抓取。
    const processed = hasCreditsText && (hasZhFile || !needsZh || !fs.existsSync(lrcAbs));
    if (!force && processed) {
      report.push({ title: f.title, result: '已处理（出处信息已在），跳过' });
      continue;
    }
    if (!fs.existsSync(audioAbs)) {
      report.push({ title: f.title, result: '音频文件不存在：' + audio });
      continue;
    }

    const buf = fs.readFileSync(audioAbs);
    let realDuration = 0;
    try {
      realDuration = mp3Duration(buf);
    } catch (err) {
      report.push({ title: f.title, result: '解析时长失败：' + err.message });
      continue;
    }
    const album = id3Text(buf, 'TALB');
    const original = fs.existsSync(lrcAbs) ? parseLrc(fs.readFileSync(lrcAbs, 'utf8')) : [];

    const res = await search(f.title, f.artist);
    if (res.error) {
      report.push({ title: f.title, result: '搜索失败，跳过：' + res.error });
      await sleep(REQUEST_GAP);
      continue;
    }

    let result;
    if (manualPicks[f.title]) {
      const hit = res.songs.find((s) => s.id === manualPicks[f.title]);
      result = hit ? { status: 'ok', chosen: hit, by: '--pick 手工指定', candidates: [hit] } : { status: 'none', candidates: [] };
    } else {
      result = selectCandidate(res.songs, realDuration, album, f.artist, f.title);
    }

    if (result.status !== 'ok') {
      const list = result.candidates.map((s) => 'id=' + s.id + ' ' + (s.duration / 1000).toFixed(2) + 's (Δ' + (s.duration / 1000 - realDuration).toFixed(2) + ') 《' + (s.album && s.album.name || '—') + '》').join('；');
      report.push({
        title: f.title,
        duration: realDuration.toFixed(2) + 's',
        candidates: result.candidates.length,
        result: result.status === 'ambiguous' ? '多个候选待定，未写入：' + list : '未找到时长 ±3s 内的候选'
      });
      await sleep(REQUEST_GAP);
      continue;
    }

    const picked = result.chosen;
    const lyricRes = await getJson(API + '/song/lyric?id=' + picked.id + '&lv=1&tv=1');
    await sleep(REQUEST_GAP);
    if (lyricRes.error) {
      report.push({ title: f.title, candidates: 1, result: '歌词请求失败，跳过：' + lyricRes.error });
      continue;
    }
    const neRaw = parseLrc((lyricRes.json.lrc && lyricRes.json.lrc.lyric) || '');
    const { credits: neCredits, lines: neLines } = splitCredits(neRaw);
    const tlyricRaw = parseLrc((lyricRes.json.tlyric && lyricRes.json.tlyric.lyric) || '');
    const { lines: tlyricLines } = splitCredits(tlyricRaw);
    const zhMap = zhMapOf(tlyricLines);
    const aligned = alignTranslation(original, neLines, zhMap);

    let detail = null;
    const detailRes = await getJson(API + '/song/detail?ids=%5B' + picked.id + '%5D');
    await sleep(REQUEST_GAP);
    if (!detailRes.error && detailRes.json.songs && detailRes.json.songs[0]) {
      const s = detailRes.json.songs[0];
      detail = { album: (s.album && s.album.name) || '', artists: (s.artists || []).map((a) => a.name).join('/') };
    }

    const credits = {
      lyricist: neCredits.lyricist || '',
      composer: neCredits.composer || '',
      arranger: neCredits.arranger || '',
      album: (detail && detail.album) || ''
    };
    Object.keys(credits).forEach((k) => { if (!credits[k]) delete credits[k]; });

    let wrote = false;
    if (needsZh && aligned.length && (!hasZhFile || force)) {
      if (!dryRun) {
        let text = aligned.map((l) => l.ts + l.text).join('\n') + '\n';
        fs.mkdirSync(path.dirname(zhAbs), { recursive: true });
        fs.writeFileSync(zhAbs, text, 'utf8');
        wrote = true;
        zhWritten++;
      }
    } else {
      zhSkipped++;
    }

    const out = [];
    const indent = block.indent + '  ';
    const zhReady = hasZhFile || wrote;
    if (zhReady) out.push(indent + 'zhlrc: ' + quoteYaml(zhRel));
    const creditKeys = ['lyricist', 'composer', 'arranger', 'album'].filter((k) => credits[k]);
    if (creditKeys.length) {
      out.push(indent + 'credits:');
      creditKeys.forEach((k) => out.push(indent + '  ' + k + ': ' + quoteYaml(credits[k])));
    }
    // 先移除旧值（幂等重跑），再在块末尾追加
    const blockLines = playlist.lines.slice(block.start, block.end + 1);
    const cleaned = blockLines.filter((line) => {
      if (/^\s{2}zhlrc:\s/.test(line)) return false;
      if (/^\s{2}credits:\s*$/.test(line)) return false;
      if (/^\s{4}(lyricist|composer|arranger|album):/.test(line)) return false;
      return true;
    });
    while (cleaned.length && !cleaned[cleaned.length - 1].trim()) cleaned.pop();
    if (!dryRun && out.length) block.newLines = cleaned.concat(out);

    report.push({
      title: f.title,
      duration: realDuration.toFixed(2) + 's',
      candidates: result.candidates.length,
      matched: 'id=' + picked.id + ' | ' + picked.duration / 1000 + 's (Δ' + (picked.duration / 1000 - realDuration).toFixed(2) + ') | 《' + (picked.album && picked.album.name || '—') + '》 | ' + result.by,
      zh: (dryRun ? '[预览] ' : '') + aligned.length + ' 行译文 / 原词 ' + original.filter((l) => l.text).length + ' 行（网易原文 ' + neLines.filter((l) => l.text).length + ' 行，译文 ' + tlyricLines.filter((l) => l.text).length + ' 行）' + (aligned.length ? '' : ' → 无可用译文，不写文件'),
      credits: ['lyricist', 'composer', 'arranger', 'album'].filter((k) => credits[k]).map((k) => k + '=' + credits[k]).join('；') || '无'
    });
    if (wrote) report[report.length - 1].result = '已写 ' + zhRel;

    await sleep(REQUEST_GAP);
  }

  if (!dryRun) {
    // 从后往前按「原文件里的块范围」整体替换，避免前面的插入让后面的行号失效
    const ranges = [];
    playlist.blocks.forEach((b) => {
      if (!b.newLines) return;
      ranges.push({ start: b.start, end: b.end, lines: b.newLines });
    });
    if (ranges.length) {
      const text = fs.readFileSync(DATA_FILE, 'utf8').split(/\r?\n/);
      ranges.sort((a, b) => b.start - a.start).forEach((r) => {
        text.splice(r.start, r.end - r.start + 1, ...r.lines);
      });
      let out = text.join(playlist.eol);
      if (out && !out.endsWith(playlist.eol)) out += playlist.eol;
      fs.writeFileSync(DATA_FILE, out, 'utf8');
    }
  }

  console.log('\n曲目 | 真实时长 | 候选数 | 结果');
  console.log('--- | --- | --- | ---');
  report.forEach((r) => console.log([r.title, r.duration || '—', r.candidates == null ? '—' : r.candidates, r.result || ''].join(' | ')));
  console.log('');
  report.forEach((r) => {
    if (r.matched) console.log('- ' + r.title + '：' + r.matched);
    if (r.zh) console.log('    译文：' + r.zh);
    if (r.credits) console.log('    曲目信息：' + r.credits);
  });
  if (dryRun) console.log('\n[dry-run] 未写入任何文件');
  else console.log('\n写入 ' + zhWritten + ' 个 .zh.lrc；无可用译文 ' + zhSkipped + ' 首');
})().catch((err) => {
  console.error('[lyrics-zh] 意外错误：', err);
  process.exit(1);
});
