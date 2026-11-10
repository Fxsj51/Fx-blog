本地音频目录
============

1. 把自有或已获授权的音频文件放在这个目录（推荐 mp3，文件名用小写英文和连字符，
   例如 my-song.mp3），不要用空格或中文文件名，避免部署后 URL 编码出问题。
2. 到 source/_data/playlist.yml 里新增一条记录，audio 字段写 music/audio/my-song.mp3。
   本地曲目不需要署名，license 写「本地曲目」即可。
3. 音频不会预加载：只有访客在 /music 页点击该曲目时才会发起请求。
4. 这个 README 会随构建一起发布到 public/music/audio/README.txt，可保留也可删除。
