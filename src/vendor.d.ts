declare module '@postlight/parser' {
  interface ParserResult {
    content?: string | null;
  }

  interface ParserOptions {
    html?: string;
    contentType?: string;
  }

  const Parser: {
    parse(url: string, options?: ParserOptions): Promise<ParserResult | null>;
  };

  export default Parser;
}
