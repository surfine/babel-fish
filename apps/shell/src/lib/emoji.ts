// Slack 標準 emoji 名稱 → Unicode。只收常用的一批；沒收到的名稱會顯示成 :name:，
// workspace 自訂 emoji 由 emoji.list 取得網址後另外處理（見 store）。
const MAP: Record<string, string> = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', ok_hand: '👌', clap: '👏', pray: '🙏', raised_hands: '🙌',
  wave: '👋', muscle: '💪', point_up: '☝️', point_right: '👉', point_left: '👈', eyes: '👀', brain: '🧠', handshake: '🤝',
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙', purple_heart: '💜', black_heart: '🖤',
  broken_heart: '💔', sparkling_heart: '💖', heart_eyes: '😍', fire: '🔥', sparkles: '✨', star: '⭐', star2: '🌟', boom: '💥',
  tada: '🎉', confetti_ball: '🎊', party_popper: '🎉', balloon: '🎈', gift: '🎁', trophy: '🏆', medal: '🏅', rocket: '🚀',
  white_check_mark: '✅', heavy_check_mark: '✔️', ballot_box_with_check: '☑️', x: '❌', heavy_multiplication_x: '✖️',
  warning: '⚠️', no_entry: '⛔', question: '❓', grey_question: '❔', exclamation: '❗', bangbang: '‼️', '100': '💯',
  smile: '😄', smiley: '😃', grinning: '😀', grin: '😁', laughing: '😆', satisfied: '😆', sweat_smile: '😅', joy: '😂',
  rolling_on_the_floor_laughing: '🤣', slightly_smiling_face: '🙂', upside_down_face: '🙃', wink: '😉', blush: '😊',
  innocent: '😇', smiling_face_with_3_hearts: '🥰', kissing_heart: '😘', yum: '😋', stuck_out_tongue: '😛',
  stuck_out_tongue_winking_eye: '😜', zany_face: '🤪', thinking_face: '🤔', thinking: '🤔', face_with_monocle: '🧐',
  nerd_face: '🤓', sunglasses: '😎', star_struck: '🤩', partying_face: '🥳', smirk: '😏', unamused: '😒', relieved: '😌',
  pensive: '😔', confused: '😕', worried: '😟', slightly_frowning_face: '🙁', frowning: '😦', anguished: '😧',
  open_mouth: '😮', hushed: '😯', astonished: '😲', flushed: '😳', pleading_face: '🥺', cry: '😢', sob: '😭',
  scream: '😱', fearful: '😨', cold_sweat: '😰', disappointed_relieved: '😥', sweat: '😓', weary: '😩', tired_face: '😫',
  yawning_face: '🥱', triumph: '😤', rage: '😡', angry: '😠', exploding_head: '🤯', face_palm: '🤦', facepalm: '🤦',
  shrug: '🤷', man_shrugging: '🤷‍♂️', woman_shrugging: '🤷‍♀️', see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊',
  skull: '💀', ghost: '👻', robot_face: '🤖', alien: '👽', clown_face: '🤡', poop: '💩', hankey: '💩',
  zipper_mouth_face: '🤐', shushing_face: '🤫', neutral_face: '😐', expressionless: '😑', no_mouth: '😶', grimacing: '😬',
  melting_face: '🫠', saluting_face: '🫡', face_with_rolling_eyes: '🙄', rolling_eyes: '🙄', sleeping: '😴', mask: '😷',
  hugging_face: '🤗', hugs: '🤗', money_mouth_face: '🤑', cowboy_hat_face: '🤠', dizzy_face: '😵',
  apple: '🍎', green_apple: '🍏', coffee: '☕', beer: '🍺', beers: '🍻', pizza: '🍕', cake: '🍰', popcorn: '🍿',
  iphone: '📱', computer: '💻', desktop_computer: '🖥️', keyboard: '⌨️', tv: '📺', watch: '⌚', headphones: '🎧',
  camera: '📷', movie_camera: '🎥', battery: '🔋', electric_plug: '🔌', bulb: '💡', mag: '🔍', lock: '🔒', key: '🔑',
  link: '🔗', paperclip: '📎', pushpin: '📌', memo: '📝', pencil2: '✏️', calendar: '📆', date: '📅', clock3: '🕒',
  hourglass: '⌛', hourglass_flowing_sand: '⏳', alarm_clock: '⏰', newspaper: '📰', books: '📚', bookmark: '🔖',
  chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊', moneybag: '💰', dollar: '💵',
  email: '📧', envelope: '✉️', inbox_tray: '📥', outbox_tray: '📤', package: '📦', bell: '🔔', no_bell: '🔕',
  loudspeaker: '📢', mega: '📣', speech_balloon: '💬', thought_balloon: '💭', zap: '⚡', sunny: '☀️', cloud: '☁️',
  umbrella: '☔', snowflake: '❄️', rainbow: '🌈', earth_americas: '🌎', globe_with_meridians: '🌐', checkered_flag: '🏁',
  rotating_light: '🚨', construction: '🚧', hammer_and_wrench: '🛠️', wrench: '🔧', gear: '⚙️', bug: '🐛', dart: '🎯',
  arrow_up: '⬆️', arrow_down: '⬇️', arrow_right: '➡️', arrow_left: '⬅️', arrows_counterclockwise: '🔄', repeat: '🔁',
  new: '🆕', free: '🆓', up: '🆙', cool: '🆒', sos: '🆘', red_circle: '🔴', large_green_circle: '🟢', large_blue_circle: '🔵',
  white_circle: '⚪', black_circle: '⚫', dog: '🐶', cat: '🐱', unicorn_face: '🦄', panda_face: '🐼', monkey_face: '🐵',
  wine_glass: '🍷', champagne: '🍾', clinking_glasses: '🥂', crossed_fingers: '🤞', v: '✌️', metal: '🤘', call_me_hand: '🤙',
  writing_hand: '✍️', nail_care: '💅', heart_hands: '🫶', salute: '🫡', mind_blown: '🤯', white_heart: '🤍',
};

const SKIN = ['', '', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];

export function emojiChar(name: string): string | undefined {
  const [base, tone] = name.split('::skin-tone-');
  const ch = MAP[base];
  if (!ch) return undefined;
  const t = tone ? SKIN[Number(tone)] : '';
  return t ? ch.replace(/️$/, '') + t : ch;
}

// 表情回應挑選器的常用清單
export const QUICK_REACTIONS = [
  '+1', 'heart', 'joy', 'eyes', 'pray', 'white_check_mark', 'tada', 'fire', 'thinking_face', '100', 'raised_hands', 'clap',
  'sweat_smile', 'sob', 'exploding_head', 'see_no_evil', 'rocket', 'apple', 'iphone', 'face_with_monocle', 'ok_hand', 'muscle',
  'sparkles', 'skull',
];

export function allEmojiNames(): string[] {
  return Object.keys(MAP);
}
