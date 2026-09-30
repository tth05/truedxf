"""Rarely used entities and plot behaviours: ACIS 3DSOLID/REGION/BODY (ezdxf polyhedral SAT/SAB),
MESH subdivision, invisible entities, LIGHT, GEODATA, locked layers, xrefs (missing, and an
ACadSharp sample DWG as a real xref), dynamic-block representations and hand-made
ACAD_PROXY_ENTITY proxy graphics (notes 03 §3.13-3.17, 07 §5/§6/§13/§14, 11b §3/§15).

Not creatable with ezdxf and therefore absent: ACAD_TABLE, OLE2FRAME, SECTION, CAMERA, curved
ACIS bodies (ezdxf only builds planar-faced ACIS data).
"""

from __future__ import annotations

import math

from ezdxf.acis import api as acis
from ezdxf.math import Matrix44
from ezdxf.render import MeshBuilder, forms

from ..core import REPO_ROOT, SuiteBuilder, suite
from ._fileformat_util import ProxyGraphicBuilder, Tags, export_acis
from .fileformat import add_proxy_entity

W = ((0, 0), (200, 150))


def _paper(c, name: str = "Layout1"):
    lay = c.doc.layouts.get(name)
    lay.page_setup(size=(200, 150), margins=(0, 0, 0, 0), units="mm", scale=16, name="truedxf", device="DWG To PDF.pc3")
    main = lay.main_viewport()
    if main is not None:
        main.dxf.layer = "0"
    return lay


def _iso_viewport(c, target=(100, 75, 0), direction=(1, -1, 1), height=160.0):
    """Layout1 with one 190x140 viewport looking along ``direction`` at ``target``; plots Layout1."""
    lay = _paper(c)
    vp = lay.add_viewport(center=(100, 75), size=(190, 140), view_center_point=(0, 0), view_height=height)
    vp.dxf.view_target_point = target
    vp.dxf.view_direction_vector = direction
    c.layout_window("Layout1", *W)
    return vp


def _box_mesh(size=60.0, center=(100, 75, 0)) -> MeshBuilder:
    return forms.cube().scale_uniform(size).translate(*center)


def _solid(c, dxftype: str = "3DSOLID", mesh: MeshBuilder | None = None):
    e = {"3DSOLID": c.msp.add_3dsolid, "BODY": c.msp.add_body, "REGION": c.msp.add_region}[dxftype]()
    export_acis(e, [acis.body_from_mesh(mesh or _box_mesh())])
    return e


@suite("misc", "ACIS solids, MESH, invisible entities, LIGHT, GEODATA, xrefs, dynamic blocks, proxy graphics",
       layer0_lineweight=0)
def build(s: SuiteBuilder) -> None:
    _acis(s)
    _mesh(s)
    _visibility(s)
    _xrefs(s)
    _dynamic_block(s)
    _proxies(s)


# --------------------------------------------------------------------------------------------


def _acis(s: SuiteBuilder) -> None:
    for v in ("R2000", "R2010", "R2013", "R2018"):
        c = s.case(f"solid-box-plan-{v.lower()}", f"3DSOLID box 60x60x60 (ezdxf polyhedral {'SAT' if v < 'R2013' else 'SAB'}) in plan view, {v}",
                   tags=["3DSOLID", "ACIS"], questions=["Q-0186", "Q-0692"] + (["Q-0103"] if v == "R2010" else []), dxfversion=v,
                   params={"dxfversion": v})
        _solid(c)
        c.window(*W)
        c.allow_audit_errors = True
    for v in ("R2010", "R2018"):
        c = s.case(f"solid-box-iso-{v.lower()}", f"3DSOLID box in a VPOINT 1,-1,1 paperspace viewport ({v}): edges only in 2D wireframe?",
                   tags=["3DSOLID", "ACIS", "VIEWPORT"], questions=["Q-0186"], dxfversion=v)
        _solid(c)
        _iso_viewport(c)
    c = s.case("solid-prism-plan", "3DSOLID hexagonal prism (polyhedral, planar faces) in plan view", tags=["3DSOLID", "ACIS"], questions=["Q-0186"])
    _solid(c, mesh=forms.extrude(forms.ngon(6, radius=50), [(0, 0, 0), (0, 0, 40)], close=True).translate(100, 75, 0))
    c.window(*W)
    c.allow_audit_errors = True
    c = s.case("body-box-plan", "BODY entity with the box ACIS data (R2010)", tags=["BODY", "ACIS"], questions=["Q-0186", "Q-0692"], dxfversion="R2010")
    _solid(c, "BODY")
    c.window(*W)
    c.allow_audit_errors = True
    for v in ("R2010", "R2013"):
        c = s.case(f"region-square-{v.lower()}", f"REGION from an ezdxf single-face ACIS body (square 120x80, may be rejected), {v}",
                   tags=["REGION", "ACIS"], questions=["Q-0186", "Q-0692"], dxfversion=v)
        m = MeshBuilder()
        m.add_face([(40, 35, 0), (160, 35, 0), (160, 115, 0), (40, 115, 0)])
        _solid(c, "REGION", m)
        c.window(*W)
        c.allow_audit_errors = True


def _mesh(s: SuiteBuilder) -> None:
    def mesh_box(c, level, size=60.0, creases=None):
        cube = _box_mesh(size)
        m = c.msp.add_mesh()
        with m.edit_data() as md:
            md.vertices = list(cube.vertices)
            md.faces = list(cube.faces)
            if creases is not None:
                edges = []
                for f in md.faces:
                    for i in range(len(f)):
                        e = tuple(sorted((f[i], f[(i + 1) % len(f)])))
                        if e not in edges:
                            edges.append(e)
                md.edges = edges
                md.edge_crease_values = [creases(e, md.vertices) for e in edges]
        m.dxf.subdivision_levels = level
        return m

    for lvl in (0, 1, 2, 3):
        c = s.case(f"mesh-box-level{lvl}-plan", f"MESH cube 60 (level-0 cage) with subdivision level {lvl}, plan view", tags=["MESH", "subdivision"],
                   questions=["Q-0190", "Q-0191"], params={"level": lvl})
        mesh_box(c, lvl)
        c.window(*W)
        c = s.case(f"mesh-box-level{lvl}-iso", f"MESH cube 60 subdivision level {lvl} in a VPOINT 1,-1,1 viewport", tags=["MESH", "subdivision", "VIEWPORT"],
                   questions=["Q-0190", "Q-0191"], params={"level": lvl})
        mesh_box(c, lvl)
        _iso_viewport(c)
    for lvl in (0, 2):
        c = s.case(f"mesh-box-level{lvl}-extents", f"MESH cube 120 level {lvl} alone; plot Extents (cage vs smoothed surface extents)", tags=["MESH", "extents"],
                   questions=["Q-0119"], params={"level": lvl})
        mesh_box(c, lvl, size=120)
        c.plot_extents()
    for cv in (-1, 0, 1, 2, 3):
        c = s.case(f"mesh-crease-{'m1' if cv < 0 else cv}", f"MESH cube level 2, top-face edges crease {cv} (others 0), VPOINT 1,-1,1",
                   tags=["MESH", "crease", "VIEWPORT"], questions=["Q-0192"], params={"crease": cv})
        mesh_box(c, 2, creases=lambda e, vs, cv=cv: float(cv) if vs[e[0]].z > 0 and vs[e[1]].z > 0 else 0.0)
        _iso_viewport(c)
    c = s.case("mesh-crease-m1-plan", "MESH cube level 2, top-face edges crease -1, plan view", tags=["MESH", "crease"], questions=["Q-0192"])
    mesh_box(c, 2, creases=lambda e, vs: -1.0 if vs[e[0]].z > 0 and vs[e[1]].z > 0 else 0.0)
    c.window(*W)
    c = s.case("mesh-ngon-level1", "MESH with a pentagon and triangles (n-gon faces) at level 1, VPOINT 1,-1,1", tags=["MESH", "subdivision"], questions=["Q-0190"])
    m = c.msp.add_mesh()
    base = [(100 + 50 * math.cos(math.tau * i / 5), 75 + 50 * math.sin(math.tau * i / 5), 0) for i in range(5)]
    with m.edit_data() as md:
        md.vertices = base + [(100, 75, 40)]
        md.faces = [list(range(5))] + [[i, (i + 1) % 5, 5] for i in range(5)]
    m.dxf.subdivision_levels = 1
    _iso_viewport(c)


def _visibility(s: SuiteBuilder) -> None:
    c = s.case("invisible-top-level", "Top-level LINE with 60=1 (invisible) next to a visible LINE", tags=["visibility"], questions=["Q-0246"])
    c.msp.add_line((20, 50), (180, 50))
    c.msp.add_line((20, 100), (180, 100), dxfattribs={"invisible": 1})
    c.msp.add_circle((100, 100), 10)
    c.window(*W)
    c = s.case("invisible-in-anonymous-block", "*U anonymous block containing a 60=1 LINE and a visible CIRCLE, inserted twice", tags=["visibility", "BLOCK"], questions=["Q-0246"])
    blk = c.doc.blocks.new_anonymous_block("U")
    blk.add_line((-40, 0), (40, 0), dxfattribs={"invisible": 1})
    blk.add_circle((0, 0), 20)
    c.msp.add_blockref(blk.name, (60, 75))
    c.msp.add_blockref(blk.name, (140, 75))
    c.window(*W)
    c = s.case("invisible-insert-with-attribs", "INSERT with 60=1 carrying visible ATTRIBs, next to a normal INSERT", tags=["visibility", "INSERT", "ATTRIB"], questions=["Q-0246"])
    blk = c.doc.blocks.new("TAGGED")
    blk.add_circle((0, 0), 15)
    blk.add_attdef("TAG", (-15, -30), dxfattribs={"height": 8})
    a = c.msp.add_blockref("TAGGED", (60, 90))
    a.add_auto_attribs({"TAG": "SHOWN"})
    b = c.msp.add_blockref("TAGGED", (140, 90), dxfattribs={"invisible": 1})
    b.add_auto_attribs({"TAG": "HIDDEN"})
    c.window(*W)
    c = s.case("layout-extents-viewports", "Layout1: small paper-space circle plus a large viewport (frame 180x130) and the overall viewport; plot Extents of the layout",
               tags=["extents", "VIEWPORT", "LAYOUT"], questions=["Q-0120"], outputs=["png", "pdf", "dxf"])
    lay = _paper(c)
    lay.add_circle((100, 75), 5)
    lay.add_viewport(center=(100, 75), size=(180, 130), view_center_point=(100, 75), view_height=130)
    c.msp.add_circle((100, 75), 40)
    c.plot_extents()
    c.plot.layout = "Layout1"
    c = s.case("locked-layer", "LINEs on a locked layer and on an unlocked layer (does PLOT fade locked layers? LAYLOCKFADECTL=50 default)",
               tags=["LAYER", "locked"], questions=["Q-0284"])
    c.layer("LOCKED", locked=True)
    for i in range(5):
        c.msp.add_line((20, 20 + i * 8), (180, 20 + i * 8), dxfattribs={"layer": "LOCKED"})
        c.msp.add_line((20, 90 + i * 8), (180, 90 + i * 8))
    c.window(*W)
    c = s.case("locked-layer-hatch", "Solid HATCH on a locked layer beside one on an unlocked layer", tags=["LAYER", "locked", "HATCH"], questions=["Q-0284"])
    c.layer("LOCKED", locked=True)
    for x, layer in ((30, "LOCKED"), (110, "0")):
        h = c.msp.add_hatch(color=7, dxfattribs={"layer": layer})
        h.paths.add_polyline_path([(x, 40), (x + 60, 40), (x + 60, 110), (x, 110)], is_closed=True)
    c.window(*W)
    for glyph in (0, 1):
        c = s.case(f"light-point-glyph-{glyph}", f"Point LIGHT at (100,75,20) with plot-glyph flag {glyph}, $LIGHTGLYPHDISPLAY 1 (R2018)",
                   tags=["LIGHT"], questions=["Q-0247"], params={"plot_glyph": glyph}, header={"$LIGHTGLYPHDISPLAY": 1})
        c.msp.add_circle((100, 75), 50)
        c.msp.new_entity("LIGHT", dxfattribs={"name": "Pointlight1", "type": 2, "status": 1, "plot_glyph": glyph, "intensity": 1.0,
                                              "location": (100, 75, 20), "target": (100, 75, 0)})
        c.window(*W)
        c.allow_audit_errors = True
    c = s.case("light-spot", "Spot LIGHT (type 3) with hotspot/falloff 30/45 degrees, plot glyph on", tags=["LIGHT"], questions=["Q-0247"])
    c.msp.add_circle((100, 75), 50)
    c.msp.new_entity("LIGHT", dxfattribs={"name": "Spot1", "type": 3, "status": 1, "plot_glyph": 1, "intensity": 1.0, "location": (60, 75, 40),
                                          "target": (140, 75, 0), "hotspot_angle": 30, "falloff_angle": 45})
    c.window(*W)
    c.allow_audit_errors = True
    for n, long_cs in (("short", False), ("long-cs", True)):
        c = s.case(f"geodata-{n}", "GEODATA geolocation (design point = WGS84 point); " + ("coordinate-system definition > 255 chars (303 continuation)" if long_cs
                   else "minimal XML definition"), tags=["GEODATA"], questions=["Q-0249"] + (["Q-0013"] if long_cs else []))
        c.msp.add_circle((100, 75), 40)
        c.msp.add_point((100, 75))
        gd = c.msp.new_geodata()
        gd.dxf.design_point = (100, 75, 0)
        gd.dxf.reference_point = (13.4, 52.5, 0)
        gd.dxf.coordinate_type = 2
        gd.dxf.horizontal_unit_scale = 1.0
        gd.dxf.vertical_unit_scale = 1.0
        gd.dxf.horizontal_units = 2
        gd.dxf.vertical_units = 2
        gd.dxf.up_direction = (0, 0, 1)
        gd.dxf.north_direction = (0, 1, 0)
        gd.coordinate_system_definition = _cs_xml(long_cs)
        c.window(*W)
        c.allow_audit_errors = True


def _cs_xml(long: bool) -> str:
    base = ('<?xml version="1.0" encoding="UTF-16" standalone="no" ?>\n'
            '<Dictionary version="1.0" xmlns="http://www.osgeo.org/mapguide/coordinatesystem">\n'
            '<Alias id="4326" type="CoordinateSystem"><ObjectId>LL84</ObjectId><Namespace>EPSG Code</Namespace></Alias>\n')
    if long:
        base += "".join(f'<Alias id="{4326 + i}" type="Datum"><ObjectId>WGS84-{i:03d}</ObjectId><Namespace>truedxf padding</Namespace></Alias>\n'
                        for i in range(8))
    return base + "</Dictionary>"


def _xrefs(s: SuiteBuilder) -> None:
    for n, flags in (("attach", 4), ("overlay", 12)):
        c = s.case(f"xref-missing-{n}", f"INSERT of an xref BLOCK (flags {flags}) whose file 'nope/missing-xref.dwg' does not exist: placeholder text plotted?",
                   tags=["XREF", "INSERT"], questions=["Q-0626"], params={"flags": flags})
        c.doc.add_xref_def("nope/missing-xref.dwg", "MISSING_XREF", flags=flags)
        c.msp.add_blockref("MISSING_XREF", (60, 60))
        c.msp.add_circle((60, 60), 3)
        c.msp.add_line((20, 20), (180, 20))
        c.window(*W)
    sample = REPO_ROOT / "research" / "repos" / "ACadSharp" / "samples" / "sample_AC1018.dwg"
    if not sample.is_file():
        return
    data = sample.read_bytes()
    variants = [("plain", None, "xref attached as-is; its Defpoints layer becomes XR|Defpoints", ["Q-0624"]),
                ("host-overrides", 1, "host table overrides XR|Layer1 red, XR|Layer2 off, XR|Layer_color_80 frozen, $VISRETAIN 1", ["Q-0625", "Q-0624"]),
                ("host-overrides-visretain0", 0, "same host overrides with $VISRETAIN 0", ["Q-0625"])]
    for n, visretain, title, qs in variants:
        c = s.case(f"xref-acs-sample-{n}", f"Host attaching ACadSharp sample_AC1018.dwg as xref XR at (0,0): {title}", tags=["XREF", "INSERT"],
                   questions=qs, outputs=["png", "pdf", "dxf"], style_table="acad.ctb")
        path = c.add_file("misc-xref-sample-ac1018.dwg", data)
        c.doc.add_xref_def(path, "XR", flags=4 | 32 | 64)
        c.msp.add_blockref("XR", (0, 0))
        c.msp.add_line((0, 150), (200, 150), dxfattribs={"color": 3})
        if visretain is not None:
            c.header(visretain=visretain)
            for ln, attrs in (("XR|Layer1", {"color": 1}), ("XR|Layer2", {"on": False}), ("XR|Layer_color_80", {"frozen": True})):
                c.layer(ln, **attrs)
                c.doc.layers.get(ln).dxf.flags |= 16 | 32
        c.fit((0, -566.17), (1852.19, 150))
        c.allow_audit_errors = True
        c.notes.append("Requires research/repos/ACadSharp/samples/sample_AC1018.dwg (copied next to the fixture).")


def _dynamic_block(s: SuiteBuilder) -> None:
    path = REPO_ROOT / "research" / "repos" / "ACadSharp" / "samples" / "dynamic-blocks" / "BLOCKVISIBILITYPARAMETER.dxf"
    if not path.is_file():
        return
    data = path.read_bytes().replace(b"\r\n", b"\n")
    for n, edit in (("as-is", False), ("definition-edited", True)):
        c = s.case(f"dynblock-visibility-{n}", "ACadSharp BLOCKVISIBILITYPARAMETER.dxf (AutoCAD-written dynamic block, 4 *U representations) "
                   + ("with the definition block's CIRCLE radius x3 and LINEs moved, *U blocks untouched" if edit else "unchanged"),
                   tags=["BLOCK", "dynamic-block"], questions=["Q-0623"], outputs=["png", "pdf", "dxf"])

        def f(_d, edit=edit):
            if not edit:
                return data
            t = Tags(data)
            a, b = t.section("BLOCKS")
            i = t.must(2, "block_visibility_parameter", a, b)
            st = i
            while t.code(st) != 0:
                st -= 1
            end = t.must(0, "ENDBLK", st)
            for cs, ce in t.entities("CIRCLE", st, end):
                j = t.must(40, None, cs, ce)
                t.set(j, repr(float(t.value(j)) * 3))
            for ls, le in t.entities("LINE", st, end):
                for code in (20, 21):
                    j = t.must(code, None, ls, le)
                    t.set(j, repr(float(t.value(j)) + 0.1))
            return t.dumps()
        c.byte_filters.append(f)
        c.allow_audit_errors = True
        c.fit((-0.1, -0.2), (1.85, 0.45))
        c.notes.append("Requires research/repos/ACadSharp/samples/dynamic-blocks/BLOCKVISIBILITYPARAMETER.dxf.")


# --------------------------------------------------------------------------------------------
# proxy graphics


def _std_graphics() -> ProxyGraphicBuilder:
    g = ProxyGraphicBuilder()
    g.circle((100, 75, 0), 30)
    g.polyline([(40, 30, 0), (160, 30, 0), (160, 120, 0), (40, 120, 0), (40, 30, 0)])
    g.arc((100, 75, 0), 45, (1, 0, 0), math.pi / 2)
    return g


def _proxies(s: SuiteBuilder) -> None:
    for v, code in (("R2010", 92), ("R2018", 160), ("R2018", 92), ("R2010", 160)):
        ok = (code == 160) == (v >= "R2013")
        c = s.case(f"proxy-basic-{v.lower()}-{code}", f"ACAD_PROXY_ENTITY (custom class, no entity data) with circle/polyline/arc proxy graphics, byte count in group {code} ({v})"
                   + ("" if ok else " (unexpected code for this version)"), tags=["ACAD_PROXY_ENTITY", "proxy-graphics"], questions=["Q-0691", "Q-0693"],
                   dxfversion=v, params={"size_code": code}, outputs=["png", "pdf", "dxf"])
        add_proxy_entity(c, _std_graphics(), code=code)
        c.msp.add_point((100, 75))
        c.window(*W)
    c = s.case("proxy-color-layer", "Proxy graphics with op 14 colour 1, op 16 layer index 1 and op 23 lineweight 50 before the geometry", tags=["ACAD_PROXY_ENTITY", "proxy-graphics"],
               questions=["Q-0693", "Q-0700"], style_table="acad.ctb")
    c.layer("PROXYL", color=3)
    g = ProxyGraphicBuilder().color(1).circle((60, 75, 0), 30).layer(2).color(256).circle((140, 75, 0), 30).lineweight(50).polyline([(20, 20), (180, 20)])
    add_proxy_entity(c, g)
    c.window(*W)
    c.params["layers"] = [ly.dxf.name for ly in c.doc.layers]
    # linetype index variants (Q-0697)
    for n, val in (("0", 0), ("1", 1), ("2", 2), ("ffffffff", 0xFFFFFFFF), ("fffffffe", 0xFFFFFFFE), ("32766", 32766), ("32767", 32767)):
        c = s.case(f"proxy-linetype-{n}", f"Proxy graphics op 18 (linetype) = {val:#x} before a polyline; LTYPE table ByBlock, ByLayer, Continuous, DASHED, CENTER",
                   tags=["ACAD_PROXY_ENTITY", "proxy-graphics", "linetype"], questions=["Q-0697"], params={"value": val})
        c.linetype("DASHED")
        c.linetype("CENTER")
        c.layer("DASHLAYER", linetype="CENTER")
        g = ProxyGraphicBuilder().linetype(val).polyline([(20, 75), (180, 75)]).polyline([(20, 40), (180, 110)])
        add_proxy_entity(c, g, layer="DASHLAYER")
        c.msp.add_line((20, 20), (180, 20), dxfattribs={"linetype": "DASHED"})
        c.params["ltype_order"] = [lt.dxf.name for lt in c.doc.linetypes]
        c.window(*W)
    for n, op in (("layer-name-15", 15), ("linetype-name-17", 17)):
        c = s.case(f"proxy-{n}", f"Proxy graphics op {op} with a name string ({'layer RED' if op == 15 else 'linetype DASHED'}) before a polyline",
                   tags=["ACAD_PROXY_ENTITY", "proxy-graphics"], questions=["Q-0698"], style_table="acad.ctb")
        c.layer("RED", color=1)
        c.linetype("DASHED")
        g = ProxyGraphicBuilder().name_attr(op, "RED" if op == 15 else "DASHED").polyline([(20, 75), (180, 75)]).circle((100, 75, 0), 30)
        add_proxy_entity(c, g)
        c.window(*W)
    c = s.case("proxy-traits-default-in-insert", "Proxy without SUBENT ops (color 0/BYBLOCK circle with normal (0,0,-1)) on layer WALLS (red) inside a block; INSERT on red layer",
               tags=["ACAD_PROXY_ENTITY", "proxy-graphics", "INSERT"], questions=["Q-0700", "Q-0701"], style_table="acad.ctb")
    c.layer("WALLS", color=1)
    c.layer("INSL", color=5)
    c.doc.blocks.new("PROXYBLK")
    g = ProxyGraphicBuilder().circle((30, 0, 0), 20, normal=(0, 0, -1)).color(0).polyline([(-40, -20), (40, -20), (40, 20)])
    add_proxy_entity(c, g, layer="WALLS", owner_block="PROXYBLK")
    c.msp.add_blockref("PROXYBLK", (100, 75), dxfattribs={"layer": "INSL", "color": 3})
    c.window(*W)
    c = s.case("proxy-in-rotated-insert", "Proxy (polyline + circle) inside a block, INSERT rotated 30 and scaled 1.5 at (100,75)", tags=["ACAD_PROXY_ENTITY", "proxy-graphics", "INSERT"],
               questions=["Q-0701"])
    c.doc.blocks.new("PROXYBLK")
    add_proxy_entity(c, ProxyGraphicBuilder().polyline([(-40, -20), (40, -20), (40, 20), (-40, 20), (-40, -20)]).circle((20, 0, 0), 10),
                     owner_block="PROXYBLK")
    c.msp.add_blockref("PROXYBLK", (100, 75), dxfattribs={"rotation": 30, "xscale": 1.5, "yscale": 1.5})
    c.msp.add_point((100, 75))
    c.window(*W)
    c = s.case("proxy-nested-matrix", "Proxy graphics with two nested PUSH_MODELXFORM (translate (60,40), then rotate 30) around a polyline", tags=["ACAD_PROXY_ENTITY", "proxy-graphics"],
               questions=["Q-0702"])
    t1 = Matrix44.translate(60, 40, 0)
    r = Matrix44.z_rotate(math.radians(30))
    rows = lambda m: [[m[j, i] for j in range(4)] for i in range(4)]  # noqa: E731  ezdxf row-vector -> column-vector rows
    sq = [(0, 0), (60, 0), (60, 30), (0, 30), (0, 0)]
    g = ProxyGraphicBuilder().polyline(sq).push_matrix(rows(t1)).polyline(sq).push_matrix(rows(r)).polyline(sq).pop_matrix().pop_matrix().circle((0, 0, 0), 5)
    add_proxy_entity(c, g)
    c.window(*W)
    c = s.case("proxy-no-graphics", "ACAD_PROXY_ENTITY without proxy graphics (92/160 = 0): bounding box or nothing?", tags=["ACAD_PROXY_ENTITY"], questions=["Q-0693", "Q-0694"])
    add_proxy_entity(c, None)
    c.window(*W)
