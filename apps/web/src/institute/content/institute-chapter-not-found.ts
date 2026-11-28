import { Schema } from "effect";

export class InstituteChapterNotFound extends Schema.TaggedError<InstituteChapterNotFound>()(
  "InstituteChapterNotFound",
  {
    chapterId: Schema.String,
  }
) {
  override get message() {
    return `Institute chapter ${this.chapterId} is not in the course manifest. Fix: use a chapter id from the course manifest.`;
  }
}
