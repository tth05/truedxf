// Minimal declarations of web-platform globals available in browsers, workers and Node, so the
// isomorphic packages can use them without the DOM lib (which would let DOM APIs slip in).
// Global script file (no imports/exports).

interface TextDecodeOptions {
    stream?: boolean;
}
interface TextDecoderOptions {
    fatal?: boolean;
    ignoreBOM?: boolean;
}
interface TextDecoder {
    readonly encoding: string;
    readonly fatal: boolean;
    decode(input?: ArrayBufferView | ArrayBuffer, options?: TextDecodeOptions): string;
}
declare var TextDecoder: {
    prototype: TextDecoder;
    new (label?: string, options?: TextDecoderOptions): TextDecoder;
};
interface TextEncoder {
    readonly encoding: string;
    encode(input?: string): Uint8Array;
}
declare var TextEncoder: {
    prototype: TextEncoder;
    new (): TextEncoder;
};
