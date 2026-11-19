"""Copy only the public Drawdown app shell; market fetching runs in Actions."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil

PUBLIC_FILES = [
    'index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest',
    'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
]

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = Path(args.output).resolve()
if output == root or output in root.parents or root in output.parents and output.name != 'dist':
    raise SystemExit('Choose a separate build output directory.')
output.mkdir(parents=True, exist_ok=True)
for name in PUBLIC_FILES:
    shutil.copy2(root / name, output / name)
digest = hashlib.sha256()
for name in sorted(PUBLIC_FILES):
    digest.update(name.encode())
    digest.update((root / name).read_bytes())
worker = (output / 'sw.js').read_text()
worker, count = re.subn(
    r"const CACHE = CACHE_PREFIX \+ '[^']+';",
    "const CACHE = CACHE_PREFIX + '" + digest.hexdigest()[:20] + "';",
    worker,
)
if count != 1:
    raise SystemExit('Drawdown worker cache declaration is missing.')
(output / 'sw.js').write_text(worker)
(output / 'data').mkdir(exist_ok=True)
print('Built Drawdown: ' + str(len(PUBLIC_FILES)) + ' public shell files')
