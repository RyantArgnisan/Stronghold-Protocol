// Web-standard UTF-8 encoder shared by Node and browsers. Do not add the entire DOM/Node global sets to the sim.
declare class TextEncoder {
  readonly encoding: 'utf-8';
  encode(input?: string): Uint8Array;
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}
