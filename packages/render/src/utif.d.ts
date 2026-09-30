// Minimal typings for utif (MIT, no bundled types).
declare module "utif" {
  interface Ifd {
    width: number;
    height: number;
    [tag: string]: unknown;
  }
  const UTIF: {
    decode(buf: ArrayBuffer): Ifd[];
    decodeImage(buf: ArrayBuffer, ifd: Ifd, ifds?: Ifd[]): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  };
  export default UTIF;
}
