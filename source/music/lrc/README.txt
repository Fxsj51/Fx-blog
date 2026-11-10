本地歌词目录
============

1. 把 .lrc 歌词文件放在这个目录，建议与音频同名，例如 my-song.lrc。
   不要用空格或中文文件名，避免部署后 URL 编码出问题。
2. 到 source/_data/playlist.yml 对应曲目里增加可选字段：
       lrc: music/lrc/my-song.lrc
   缺省该字段时，音乐页歌词栏显示「纯音乐，请欣赏」。
3. 支持标准 LRC 时间轴：[mm:ss]、[mm:ss.xx]、[mm:ss.xxx]，一行可写多个时间标签；
   也识别 [offset:+/-毫秒]。只有带时间轴且有文字的歌词行会被显示，
   [ti:]、[ar:]、[al:] 等标签会被忽略。
4. 歌词随播放高亮并自动滚动居中；播放/暂停、切歌、进度拖动均沿用现有播放器逻辑。
5. 这个 README 会随构建一起发布到 public/music/lrc/README.txt，可保留也可删除。
