#!/usr/bin/env bash
# Re-create research/repos (shallow clones of reference libraries). See research/repos.md.
set -e
cd "$(dirname "$0")/../repos" 2>/dev/null || { mkdir -p "$(dirname "$0")/../repos"; cd "$(dirname "$0")/../repos"; }
export MSYS_NO_PATHCONV=1
clone() { [ -d "$2" ] || git clone -q --depth 1 "https://github.com/$1.git" "$2"; }
clone mozman/ezdxf ezdxf
clone vagran/dxf-viewer dxf-viewer
clone vagran/dxf-viewer-example-src dxf-viewer-example
clone gdsestimating/dxf-parser dxf-parser
clone gdsestimating/three-dxf three-dxf
clone bjnortier/dxf bjnortier-dxf
clone dotoritos-kim/dxf-json dxf-json
clone LibreCAD/libdxfrw libdxfrw
clone DomCR/ACadSharp ACadSharp
clone haplokuon/netDxf netDxf
clone ixmilia/dxf ixmilia-dxf
clone ixmilia/dxf-rs ixmilia-dxf-rs
clone tarikjabiri/dxf tarikjabiri-dxf
clone mlightcad/cad-viewer mlightcad-cad-viewer
clone mlightcad/realdwg-web mlightcad-realdwg-web
clone LibreDWG/libredwg libredwg
clone LibreCAD/LibreCAD LibreCAD
clone qcad/qcad qcad
clone jscad/sample-files jscad-sample-files
if [ ! -d gdal ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/OSGeo/gdal.git gdal
  (cd gdal && git sparse-checkout set --no-cone 'ogr/ogrsf_frmts/dxf/' 'autotest/ogr/data/dxf/' '/autotest/ogr/ogr_dxf.py' '/doc/source/drivers/vector/dxf.rst')
fi
if [ ! -d FreeCAD ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/FreeCAD/FreeCAD.git FreeCAD
  (cd FreeCAD && git sparse-checkout set --no-cone 'src/Mod/Import/App/dxf/' '/src/Mod/Draft/importDXF.py')
fi
