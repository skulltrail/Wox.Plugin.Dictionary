from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'plugin.json').read_text())
package = json.loads((root / 'package.json').read_text())
if manifest['Version'] != package['version']:
    raise SystemExit('plugin.json and package.json versions differ')
output = root / 'dist' / 'wox.plugin.Dictionary.wox'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for source, target in [('plugin.json', 'plugin.json'), ('src/index.js', 'index.js'), ('images/icon.svg', 'images/icon.svg')]:
        archive.write(root / source, target)
with zipfile.ZipFile(output) as archive:
    if archive.testzip() or set(archive.namelist()) != {'plugin.json', 'index.js', 'images/icon.svg'}:
        raise SystemExit('Invalid plugin archive')
print(output)
