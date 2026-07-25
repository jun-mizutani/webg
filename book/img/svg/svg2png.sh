#!/bin/bash
# svg2png.sh file.svg

/Applications/Inkscape.app/Contents/MacOS/inkscape "$1" --export-type=png \
  --export-background=white \
  --export-filename="${1%.svg}.png"
