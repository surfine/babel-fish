"""產生 BabelFish.icon/Assets 的魚圖層。

巴別魚照原著設定：小、黃、有點像水蛭的魚。原創的部分是「肋骨」：
魚身裡的骨頭畫成從眼睛往後擴散的聲波弧線，表示牠吸收腦波、把聽到的話翻譯出來。
圖層：fish.svg（魚身，玻璃）、waves.svg（聲波肋骨，前景）、eye.svg（眼睛）。
"""
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "BabelFish.icon" / "Assets"
HEAD = (712, 512)   # 聲波的圓心，也是眼睛附近


def svg(body: str, note: str) -> str:
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n'
            f"  <!-- {note}。由 icons/source/make_fish.py 產生 -->\n{body}</svg>\n")


def main():
    body = (
        "M 806 520 C 798 418, 660 360, 520 372 C 430 380, 362 418, 322 470 "
        "L 236 402 C 218 388, 196 400, 204 422 L 244 516 L 204 610 C 196 632, 218 644, 236 630 "
        "L 322 562 C 362 614, 430 652, 520 660 C 660 672, 798 622, 806 520 Z"
    )
    dorsal = "M 470 384 C 500 318, 588 300, 640 372 C 590 368, 530 372, 470 384 Z"
    pelvic = "M 520 652 C 548 704, 612 716, 640 690 C 600 676, 560 664, 520 652 Z"
    (OUT / "fish.svg").write_text(svg(
        f'  <path fill="#f4c430" d="{body}"/>\n  <path fill="#e6ab17" d="{dorsal}"/>\n  <path fill="#e6ab17" d="{pelvic}"/>\n',
        "巴別魚的魚身：小、黃、有點像水蛭"))
    arcs = []
    cx, cy = HEAD
    for r in (92, 156, 220):
        span = math.radians(42 - r / 22)          # 越外圈弧度越小，留在魚身裡
        a0, a1 = math.pi - span, math.pi + span
        x0, y0 = cx + r * math.cos(a0), cy - r * math.sin(a0)
        x1, y1 = cx + r * math.cos(a1), cy - r * math.sin(a1)
        arcs.append(f'  <path d="M {x0:.1f} {y0:.1f} A {r} {r} 0 0 0 {x1:.1f} {y1:.1f}" fill="none" stroke="#fff4cf" stroke-width="20" stroke-linecap="round"/>\n')
    (OUT / "waves.svg").write_text(svg("".join(arcs), "聲波肋骨：從眼睛往後擴散"))
    (OUT / "eye.svg").write_text(svg('  <circle cx="742" cy="488" r="24" fill="#16213f"/>\n  <circle cx="750" cy="480" r="7" fill="#ffffff"/>\n', "眼睛"))


if __name__ == "__main__":
    main()
