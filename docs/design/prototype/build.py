"""把原型源文件拼成单文件 docs/design/prototype.html。用法：python3 build.py"""
import json, pathlib
here = pathlib.Path(__file__).resolve().parent
shell = (here / "shell.html").read_text(encoding="utf-8")
data = json.loads((here / "snapshot-2026-10-26.json").read_text(encoding="utf-8"))
js = "\n".join((here / f).read_text(encoding="utf-8") for f in ["core.js", "ui-base.js", "ui-market.js", "ui-trade.js", "ui-learn.js", "ui-ai.js", "ui-me.js"])
out = shell.replace("/*DATA*/", json.dumps(data, ensure_ascii=False, separators=(",", ":"))).replace("/*JS*/", js.replace("</script>", "<\\/script>"))
(here.parent / "prototype.html").write_text(out, encoding="utf-8")
print("wrote", here.parent / "prototype.html", len(out) // 1024, "KB")
