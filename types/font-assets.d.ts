declare module '*.woff?url' {
  const url: string;
  export default url;
}

declare module '*.mesh?url' {
  const url: string;
  export default url;
}

declare module '@shuding/opentype.js' {
  export type MoveCommand = { type: 'M'; x: number; y: number };
  export type LineCommand = { type: 'L'; x: number; y: number };
  export type CubicCommand = {
    type: 'C';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    x: number;
    y: number;
  };
  export type QuadraticCommand = {
    type: 'Q';
    x1: number;
    y1: number;
    x: number;
    y: number;
  };
  export type CloseCommand = { type: 'Z' };
  export type PathCommand =
    | MoveCommand
    | LineCommand
    | CubicCommand
    | QuadraticCommand
    | CloseCommand;

  export type Path = { commands: PathCommand[] };
  export type Font = {
    getPath(
      text: string,
      x?: number,
      y?: number,
      fontSize?: number,
      options?: { tracking?: number },
    ): Path;
  };

  export function parse(buffer: ArrayBuffer): Font;
}
