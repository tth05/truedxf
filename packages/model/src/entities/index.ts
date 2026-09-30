import "./basic.ts";
import "./polyline.ts";
import "./text.ts";
import "./mtext.ts";

import type {
  ArcEntity,
  CircleEntity,
  EllipseEntity,
  Face3dEntity,
  LineEntity,
  PointEntity,
  RayEntity,
  ShapeEntity,
  SolidEntity,
  SplineEntity,
} from "./basic.ts";
import type { EntityBase } from "./common.ts";
import type { MTextEntity } from "./mtext.ts";
import type { LwPolylineEntity, PolylineEntity, VertexEntity } from "./polyline.ts";
import type { AttribEntity, InsertEntity, TextEntity } from "./text.ts";

export * from "./basic.ts";
export * from "./common.ts";
export * from "./mtext.ts";
export * from "./polyline.ts";
export * from "./text.ts";

/** Entity of a type without a dedicated parser. Tags are available via `record`. */
export interface UnknownEntity extends EntityBase {
  readonly type: "UNKNOWN";
}

export type Entity =
  | LineEntity
  | PointEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | SolidEntity
  | Face3dEntity
  | RayEntity
  | SplineEntity
  | ShapeEntity
  | LwPolylineEntity
  | PolylineEntity
  | VertexEntity
  | TextEntity
  | AttribEntity
  | InsertEntity
  | MTextEntity
  | UnknownEntity;

export type EntityType = Entity["type"];
