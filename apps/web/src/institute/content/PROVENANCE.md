# Institute wire format

`schema.ts` and `slideshow.ts` adapt Kit Langton's Effect Institute compiler schemas at `559b4ea0a1b3651705d4576de43505c2e0cb0250`: `src/lib/tooling/types.ts`, `src/lib/animated-code/slideshow.ts` and `src/lib/animated-code/annotations.ts`. The published filenames and optional narration come from `src/backend/services/course/builder.ts`. The adapted schemas use Effect 4 structs with finite numbers and constrain asset filenames to the compiler's hashed format.

## MIT License

Copyright (c) 2026 Kit Langton

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
