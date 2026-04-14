#!/bin/bash
# svg2pngall.sh

for f in *.svg
do
  /Applications/Inkscape.app/Contents/MacOS/inkscape "$f" --export-type=png \
  --export-background=white--export-filename="${f%.svg}.png"
done
