import {
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
} from "mediabunny";

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("사용자가 작업을 취소했습니다.", "AbortError");
}

async function pipeTrack({
  track,
  source,
  decoderConfig,
  duration,
  timestampOffset,
  signal,
  onTrackProgress,
}) {
  const sink = new EncodedPacketSink(track);
  let firstPacket = true;

  try {
    for await (const packet of sink.packets()) {
      throwIfAborted(signal);
      const shiftedTimestamp = packet.timestamp + timestampOffset;
      const outputPacket = timestampOffset === 0
        ? packet
        : packet.clone({ timestamp: Math.max(0, shiftedTimestamp) });
      await source.add(outputPacket, firstPacket ? { decoderConfig } : undefined);
      firstPacket = false;
      if (duration > 0) {
        onTrackProgress(Math.min(1, Math.max(0, (packet.timestamp + packet.duration) / duration)));
      }
    }
    onTrackProgress(1);
  } finally {
    source.close();
  }
}

export async function remuxSeparateInputs({
  videoInput,
  audioInput,
  output,
  signal,
  onProgress = () => {},
}) {
  throwIfAborted(signal);

  const [videoTrack, audioTrack] = await Promise.all([
    videoInput.getPrimaryVideoTrack(),
    audioInput.getPrimaryAudioTrack(),
  ]);
  if (!videoTrack || !audioTrack) {
    throw new Error("영상 트랙과 음성 트랙을 모두 찾지 못했습니다.");
  }

  const [videoCodec, audioCodec, videoDecoderConfig, audioDecoderConfig] = await Promise.all([
    videoTrack.getCodec(),
    audioTrack.getCodec(),
    videoTrack.getDecoderConfig(),
    audioTrack.getDecoderConfig(),
  ]);
  if (!videoCodec || !audioCodec || !videoDecoderConfig || !audioDecoderConfig) {
    throw new Error("MP4 결합에 필요한 코덱 정보를 읽지 못했습니다.");
  }

  const [videoDuration, audioDuration, videoFirstTimestamp, audioFirstTimestamp, rotation, audioLanguage] = await Promise.all([
    videoTrack.getDurationFromMetadata(),
    audioTrack.getDurationFromMetadata(),
    videoTrack.getFirstTimestamp(),
    audioTrack.getFirstTimestamp(),
    videoTrack.getRotation(),
    audioTrack.getLanguageCode(),
  ]);
  const timestampOffset = Math.max(0, -Math.min(videoFirstTimestamp, audioFirstTimestamp));

  const videoSource = new EncodedVideoPacketSource(videoCodec);
  const audioSource = new EncodedAudioPacketSource(audioCodec);
  output.addVideoTrack(videoSource, { rotation });
  output.addAudioTrack(audioSource, { languageCode: audioLanguage });

  const progress = { video: 0, audio: 0 };
  const report = (kind, value) => {
    progress[kind] = value;
    onProgress((progress.video + progress.audio) / 2);
  };

  try {
    await output.start();
    await Promise.all([
      pipeTrack({
        track: videoTrack,
        source: videoSource,
        decoderConfig: videoDecoderConfig,
        duration: videoDuration ?? 0,
        timestampOffset,
        signal,
        onTrackProgress: (value) => report("video", value),
      }),
      pipeTrack({
        track: audioTrack,
        source: audioSource,
        decoderConfig: audioDecoderConfig,
        duration: audioDuration ?? 0,
        timestampOffset,
        signal,
        onTrackProgress: (value) => report("audio", value),
      }),
    ]);
    throwIfAborted(signal);
    await output.finalize();
    onProgress(1);
  } catch (error) {
    if (output.state !== "canceled" && output.state !== "finalized") {
      await output.cancel().catch(() => {});
    }
    throw error;
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}
