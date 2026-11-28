import { Schema } from "effect";

export class InstituteSectionNotFound extends Schema.TaggedError<InstituteSectionNotFound>()(
  "InstituteSectionNotFound",
  {
    chapterId: Schema.String,
    sectionId: Schema.String,
  }
) {
  override get message() {
    return `Institute section ${this.chapterId}/${this.sectionId} is not in its chapter manifest. Fix: use a section id from the chapter manifest.`;
  }
}
