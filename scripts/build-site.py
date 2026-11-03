"""Build an allowlisted static Pages artifact; never publish repository data files."""
import json
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
subprocess.run(['python3', str(root/'scripts/prepare-shell.py'), '--check'], check=True)
output = root/'dist'
if output.exists():
    shutil.rmtree(output)
output.mkdir()
files = ['index.html','cardio.js','program.js','app.js','styles.css','sw.js','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png']
for name in files:
    shutil.copy2(root/name, output/name)
(output/'.nojekyll').touch()
version = json.loads((root/'package.json').read_text())['version']
commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
(output/'release.json').write_text(json.dumps({'version':version,'commit':commit,'storageSchema':1})+'\n')
print('Built LiftLog '+version+': '+str(len(list(output.iterdir())))+' public files')
