use rosetta_shell_lib::guide::{place_card, Rect, CARD_H, CARD_W};

const SCREEN: Rect = Rect { x: 0.0, y: 0.0, w: 1728.0, h: 1117.0 };

fn inside(p: (f64, f64), r: Rect) -> bool {
    p.0 >= r.x && p.1 >= r.y && p.0 + CARD_W <= r.x + r.w && p.1 + CARD_H <= r.y + r.h
}

#[test]
fn card_goes_right_of_slack_when_there_is_room() {
    let slack = Rect { x: 100.0, y: 80.0, w: 1000.0, h: 800.0 };
    let p = place_card(Some(slack), SCREEN, CARD_H);
    assert!(p.0 >= slack.x + slack.w, "在 Slack 右側外面：{p:?}");
    assert_eq!(p.1 + CARD_H, slack.y + slack.h, "底部對齊 Slack 視窗底部（輸入框那一帶）");
}

#[test]
fn card_goes_left_when_slack_hugs_the_right_edge() {
    let slack = Rect { x: 500.0, y: 0.0, w: 1228.0, h: 1000.0 };
    let p = place_card(Some(slack), SCREEN, CARD_H);
    assert!(p.0 + CARD_W <= slack.x, "在 Slack 左側外面：{p:?}");
}

#[test]
fn full_screen_slack_gets_card_inside_above_composer() {
    let p = place_card(Some(SCREEN), SCREEN, CARD_H);
    assert!(inside(p, SCREEN));
    assert!(p.1 + CARD_H <= SCREEN.h - 140.0, "不擋住底部的輸入框：{p:?}");
}

#[test]
fn no_slack_window_falls_back_to_bottom_right_and_stays_on_screen() {
    let p = place_card(None, SCREEN, CARD_H);
    assert!(inside(p, SCREEN));
    assert!(p.0 > SCREEN.w / 2.0 && p.1 > SCREEN.h / 2.0);
    // 第二個螢幕（座標不從 0 開始）也要在螢幕內
    let second = Rect { x: 1728.0, y: -200.0, w: 2560.0, h: 1440.0 };
    assert!(inside(place_card(None, second, CARD_H), second));
}

#[test]
fn shorter_card_still_bottom_aligned() {
    let slack = Rect { x: 100.0, y: 80.0, w: 1000.0, h: 800.0 };
    let p = place_card(Some(slack), SCREEN, 140.0);
    assert_eq!(p.1 + 140.0, slack.y + slack.h);
}
