export const preferredAudio = (
  audio: Pick<HTMLMediaElement, "canPlayType">,
  webm: string | undefined,
  aac?: string
): string | undefined =>
  webm !== undefined && audio.canPlayType('audio/webm; codecs="opus"') !== ""
    ? webm
    : aac;
