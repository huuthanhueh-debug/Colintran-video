// PromptGate Video UI strings, Vietnamese and English. Every key must exist in both languages
// (tests/video.js checks). Functions take the values to insert.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PGI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STRINGS = {
    vi: {
      'tab.brief': 'Ý tưởng', 'tab.scenes': 'Cảnh', 'tab.prompts': 'Prompt', 'tab.export': 'Xuất',
      'summary': (title, n, time, aspect) => `${title} · ${n} cảnh · ${time} · ${aspect}`,
      'summary.empty': 'Chưa có storyboard: nhập ý tưởng rồi bấm Tạo storyboard.',
      'brief.label': 'Ý tưởng video', 'brief.hint': '(mỗi câu hoặc mỗi dòng là một cảnh)',
      'brief.ph': 'Ví dụ:\nBình minh trên bãi biển Vũng Tàu, sóng nhẹ.\nLễ tân mỉm cười chào khách ở sảnh khách sạn.\nCăn suite hướng biển, rèm mở đón nắng.',
      'keep.label': 'Giữ xuyên suốt', 'keep.hint': '(nhân vật, sản phẩm, bối cảnh, không bắt buộc)',
      'keep.ph': 'Ví dụ: a beachfront suite hotel in Vung Tau, staff in beige uniforms',
      'aspect': 'Khung hình', 'aspect.9:16': '9:16 (dọc: TikTok, Reels)', 'aspect.16:9': '16:9 (ngang: YouTube)', 'aspect.1:1': '1:1 (vuông)',
      'total': 'Tổng thời lượng (giây)', 'style': 'Phong cách', 'make': 'Tạo storyboard',
      'brief.note': 'Prompt gửi cho công cụ AI nên viết bằng tiếng Anh để ra hình đúng ý. App không dịch: bạn viết thế nào, cảnh giữ nguyên thế ấy.',
      'brief.empty': 'Hãy nhập ít nhất một câu mô tả.', 'brief.replace': 'Thay storyboard hiện tại bằng storyboard mới?',
      'scene.none': 'Chưa có cảnh nào.', 'scene.n': (i) => `Cảnh ${i}`, 'scene.add': '+ Thêm cảnh', 'scene.max': (n) => `Tối đa ${n} cảnh.`,
      'scene.up': 'Lên', 'scene.down': 'Xuống', 'scene.delete': 'Xoá cảnh',
      'scene.text': 'Mô tả cảnh (dùng cho prompt)', 'scene.caption': 'Phụ đề trên video', 'scene.seconds': 'Giây',
      'scene.shot': 'Cỡ cảnh', 'scene.motion': 'Máy quay', 'scene.transition': 'Chuyển cảnh',
      'media.add': 'Gắn ảnh / clip', 'media.change': 'Đổi ảnh / clip', 'media.remove': 'Gỡ', 'media.bad': 'Không đọc được file này.',
      'cat.generative': 'Tạo clip từ prompt', 'cat.avatar': 'Người dẫn ảo đọc kịch bản', 'cat.editor': 'Dựng cả video từ kịch bản', 'cat.gone': 'Đã ngừng',
      'len.range': (a, b) => `${a}–${b} giây mỗi clip`, 'len.clips': (list) => `${list} giây mỗi clip`, 'len.plan': 'theo gói đăng ký',
      'tool.line': (len, aspects, audio, inputs) => `Độ dài: ${len} · Khung: ${aspects} · Âm thanh gốc: ${audio} · Đầu vào: ${inputs}`,
      'yes': 'có', 'no': 'không', 'source': 'Nguồn tham khảo', 'checked': (d) => ` · thông số đối chiếu ngày ${d}, các hãng đổi thường xuyên`,
      'prompts.none': 'Chưa có cảnh: tạo storyboard ở tab Ý tưởng.',
      'copy': 'Sao chép', 'copy.all': 'Sao chép tất cả', 'copied': 'Đã sao chép', 'copy.fail': 'Không sao chép được, hãy chọn và chép tay.',
      'play': '▶ Xem thử', 'pause': '❚❚ Dừng', 'seek': 'Vị trí',
      'quality': 'Chất lượng', 'quality.360': '360p (nhẹ)', 'music': 'Nhạc nền', 'volume': 'Âm lượng nhạc',
      'captions': 'Hiện phụ đề trên video', 'clipAudio': 'Giữ âm thanh gốc của clip',
      'export': 'Xuất video', 'export.cancel': 'Huỷ xuất', 'export.running': 'Đang xuất, giữ app mở…',
      'export.done': (w, h, mb, where) => `Xong: ${w}×${h}, ${mb} MB, lưu tại ${where}`, 'export.fail': (why) => 'Không xuất được: ' + why,
      'export.note': 'Xuất chạy theo thời gian thực: video 30 giây mất khoảng 30 giây. Giữ app mở trên màn hình trong lúc xuất.',
      'save.srt': 'Lưu phụ đề .srt', 'save.json': 'Lưu dự án .json', 'open.json': 'Mở dự án',
      'saved': (where) => 'Đã lưu: ' + where, 'downloads': (name) => 'thư mục Tải xuống: ' + name,
      'opened': (title, n) => `Đã mở: ${title} (${n} cảnh). Ảnh và clip cần gắn lại.`, 'open.bad': 'File không phải dự án PromptGate Video hợp lệ.',
      'err.noScenes': 'Chưa có cảnh nào để xuất.', 'err.noRecorder': 'Thiết bị này không hỗ trợ ghi video (MediaRecorder).',
      'err.recordError': 'Lỗi ghi video.', 'err.cancelled': 'Đã huỷ.', 'err.emptyVideo': 'Video rỗng: thiết bị không mã hoá được định dạng này.',
      'err.create': 'Không tạo được file trên máy.', 'err.write': 'Ghi file thất bại (hết bộ nhớ?).', 'err.save': 'Không lưu được file.',
    },
    en: {
      'tab.brief': 'Idea', 'tab.scenes': 'Scenes', 'tab.prompts': 'Prompts', 'tab.export': 'Export',
      'summary': (title, n, time, aspect) => `${title} · ${n} scene${n === 1 ? '' : 's'} · ${time} · ${aspect}`,
      'summary.empty': 'No storyboard yet: type your idea, then tap Create storyboard.',
      'brief.label': 'Video idea', 'brief.hint': '(each sentence or line becomes a scene)',
      'brief.ph': 'Example:\nSunrise over Vung Tau beach, gentle waves.\nA receptionist smiles and greets a guest in the hotel lobby.\nAn ocean-view suite, curtains opening to the sunlight.',
      'keep.label': 'Keep consistent', 'keep.hint': '(character, product, setting; optional)',
      'keep.ph': 'Example: a beachfront suite hotel in Vung Tau, staff in beige uniforms',
      'aspect': 'Frame', 'aspect.9:16': '9:16 (portrait: TikTok, Reels)', 'aspect.16:9': '16:9 (landscape: YouTube)', 'aspect.1:1': '1:1 (square)',
      'total': 'Total length (seconds)', 'style': 'Style', 'make': 'Create storyboard',
      'brief.note': 'AI video tools follow English prompts best. The app does not translate: scenes keep the words you type.',
      'brief.empty': 'Type at least one sentence.', 'brief.replace': 'Replace the current storyboard with a new one?',
      'scene.none': 'No scenes yet.', 'scene.n': (i) => `Scene ${i}`, 'scene.add': '+ Add scene', 'scene.max': (n) => `Up to ${n} scenes.`,
      'scene.up': 'Move up', 'scene.down': 'Move down', 'scene.delete': 'Delete scene',
      'scene.text': 'Scene description (used in prompts)', 'scene.caption': 'Caption on the video', 'scene.seconds': 'Seconds',
      'scene.shot': 'Shot size', 'scene.motion': 'Camera', 'scene.transition': 'Transition',
      'media.add': 'Attach image / clip', 'media.change': 'Change image / clip', 'media.remove': 'Remove', 'media.bad': 'This file could not be read.',
      'cat.generative': 'Generates clips from prompts', 'cat.avatar': 'Avatar presenter reads a script', 'cat.editor': 'Builds the whole video from a script', 'cat.gone': 'Shut down',
      'len.range': (a, b) => `${a}–${b} seconds per clip`, 'len.clips': (list) => `${list} seconds per clip`, 'len.plan': 'depends on your plan',
      'tool.line': (len, aspects, audio, inputs) => `Length: ${len} · Frames: ${aspects} · Native audio: ${audio} · Inputs: ${inputs}`,
      'yes': 'yes', 'no': 'no', 'source': 'Source', 'checked': (d) => ` · specs checked on ${d}; vendors change them often`,
      'prompts.none': 'No scenes yet: create a storyboard in the Idea tab.',
      'copy': 'Copy', 'copy.all': 'Copy all', 'copied': 'Copied', 'copy.fail': 'Could not copy; select the text and copy it by hand.',
      'play': '▶ Preview', 'pause': '❚❚ Pause', 'seek': 'Position',
      'quality': 'Quality', 'quality.360': '360p (light)', 'music': 'Background music', 'volume': 'Music volume',
      'captions': 'Show captions on the video', 'clipAudio': 'Keep the original sound of clips',
      'export': 'Export video', 'export.cancel': 'Cancel export', 'export.running': 'Exporting, keep the app open…',
      'export.done': (w, h, mb, where) => `Done: ${w}×${h}, ${mb} MB, saved to ${where}`, 'export.fail': (why) => 'Export failed: ' + why,
      'export.note': 'Export runs in real time: a 30-second video takes about 30 seconds. Keep the app on screen while it exports.',
      'save.srt': 'Save captions .srt', 'save.json': 'Save project .json', 'open.json': 'Open project',
      'saved': (where) => 'Saved: ' + where, 'downloads': (name) => 'Downloads folder: ' + name,
      'opened': (title, n) => `Opened: ${title} (${n} scenes). Images and clips need attaching again.`, 'open.bad': 'This file is not a valid PromptGate Video project.',
      'err.noScenes': 'There are no scenes to export.', 'err.noRecorder': 'This device cannot record video (MediaRecorder).',
      'err.recordError': 'Video recording error.', 'err.cancelled': 'Cancelled.', 'err.emptyVideo': 'Empty video: this device could not encode the format.',
      'err.create': 'Could not create the file on this device.', 'err.write': 'Writing the file failed (storage full?).', 'err.save': 'Could not save the file.',
    },
  };
  const LANGS = Object.keys(STRINGS);
  // translate(lang)(key, ...values). Unknown keys come back unchanged so nothing renders blank.
  function translate(lang) {
    const table = STRINGS[LANGS.includes(lang) ? lang : 'vi'];
    return (key, ...values) => {
      const v = table[key];
      return v == null ? key : typeof v === 'function' ? v(...values) : v;
    };
  }
  return { STRINGS, LANGS, translate };
});
