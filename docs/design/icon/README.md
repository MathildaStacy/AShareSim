# App 图标

深色底 + 三根上涨的 K 线（红涨绿跌，颜色同 `src/ui/theme.ts`）。

- `icon.svg` / `icon_round.svg`：方形和圆形的完整图标，生成 Android 旧版图标（`mipmap-*/ic_launcher*.png`）。
- `gen_icon.py`：生成上面两个 SVG 和自适应图标前景 `android/app/src/main/res/drawable/ic_launcher_foreground.xml`。
- 自适应图标（Android 8+）：`mipmap-anydpi-v26/ic_launcher*.xml`，背景色 `values/ic_launcher_background.xml`。

重新生成：在本目录运行 `python3 gen_icon.py`，把 `ic_launcher_foreground.xml` 复制到 `drawable/`，再用 `rsvg-convert -w <48/72/96/144/192>` 把 SVG 转成各密度的 PNG。
