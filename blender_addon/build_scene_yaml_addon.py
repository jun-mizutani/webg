"""Build the distributable Webg SceneYAML Blender add-on archive."""
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parent
PACKAGE = ROOT / 'blender_scene_yaml'
ARCHIVE = ROOT / 'blender_scene_yaml.zip'
FILES = ('__init__.py', 'animation.py', 'scene_yaml.py', 'blender_animation.py')


def main():
    """Write only the add-on package files into a clean ZIP archive."""
    with zipfile.ZipFile(ARCHIVE, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(PACKAGE / name, f'blender_scene_yaml/{name}')
    print(f'Wrote {ARCHIVE}')


if __name__ == '__main__':
    main()
