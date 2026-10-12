#!/usr/bin/env bash
# Dump all GitHub threads used by the knowledge base, then fetch attachments and rebuild the corpus index.
set -e
cd "$(dirname "$0")"
python dump_github.py mozman/ezdxf vagran/dxf-viewer gdsestimating/dxf-parser gdsestimating/three-dxf bjnortier/dxf \
    dotoritos-kim/dxf-json ixmilia/dxf tarikjabiri/dxf mlightcad/cad-viewer mlightcad/realdwg-web \
    DomCR/ACadSharp haplokuon/netDxf LibreCAD/libdxfrw LibreDWG/libredwg LibreCAD/LibreCAD \
    "OSGeo/gdal?dxf" "FreeCAD/FreeCAD?dxf" "qgis/QGIS?dxf in:title"
python fetch_attachments.py
python build_corpus.py
