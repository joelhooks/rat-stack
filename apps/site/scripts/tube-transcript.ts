export const transcriptCues = (vtt: string) => {
  const cues: { at: number; text: string }[] = [];
  let previous: string[] = [];

  for (const block of vtt.replaceAll("\r", "").split(/\n\s*\n/u)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes(" --> "));

    const stamp = lines[timing]?.match(
      /^(?:(?<hours>\d+):)?(?<minutes>\d{2}):(?<seconds>\d{2})\.\d{3} --> /u
    );

    if (stamp === undefined || stamp === null) {
      continue;
    }

    const words = lines
      .slice(timing + 1)
      .join(" ")
      .replaceAll(/<[^>]*>/gu, "")
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .trim()
      .split(/\s+/u)
      .filter(Boolean);

    let overlap = 0;

    for (
      let size = 1;
      size <= Math.min(previous.length, words.length);
      size += 1
    ) {
      if (previous.slice(-size).join(" ") === words.slice(0, size).join(" ")) {
        overlap = size;
      }
    }

    const text = words.slice(overlap).join(" ");
    previous = words;

    if (text.length > 0) {
      cues.push({
        at:
          Number(stamp.groups?.hours ?? 0) * 3600 +
          Number(stamp.groups?.minutes) * 60 +
          Number(stamp.groups?.seconds),
        text,
      });
    }
  }

  return cues;
};

export const transcriptChunks = (vtt: string) => {
  const chunks: { at: number; text: string }[] = [];

  for (const cue of transcriptCues(vtt)) {
    const last = chunks.at(-1);

    if (last !== undefined && cue.at - last.at < 60) {
      last.text += ` ${cue.text}`;
    } else {
      chunks.push({ ...cue });
    }
  }

  return chunks;
};
