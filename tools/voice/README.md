# "Hey Garden" — models

All speech runs on the Jetson (sherpa-onnx, CPU). The models live in the gitignored
`data/voice/models/` (~150 MB on disk, ~380 MB resident):

```sh
mkdir -p data/voice/models && cd data/voice/models
B=https://github.com/k2-fsa/sherpa-onnx/releases/download
curl -sL $B/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2 | tar xj   # wake word
curl -sL $B/asr-models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2 | tar xj  # speech → text
curl -sL -o silero_vad.onnx $B/asr-models/silero_vad.onnx                                      # end of speech
```

The wake phrase is given to the keyword spotter as the model's own pieces. To change it:
`python3 -I tools/voice/bpe-keyword.py data/voice/models/sherpa-onnx-kws-*/bpe.model "HEY GARDEN"`
→ put the output in `KEYWORDS` and the matching words in `WAKE_RE` (src/voice.mjs).

QA without speaking: `curl -X POST -d '{"text":"open the weather"}' http://127.0.0.1:8797/say`
(curl only — browser origins are refused). `GARDENER_VOICE_DEBUG=1` logs tool inputs; normal
running logs only tool names.

## Push-to-talk (MX Master 3 square button)
`src/hidpp.mjs` diverts the button under the wheel (HID++ control 0x00C4) so holding it talks to
Hey Garden (pad.mjs → POST /ptt). It needs access to the Logitech receiver's hidraw node:

```sh
sudo sh -c 'echo "KERNEL==\"hidraw*\", ATTRS{idVendor}==\"046d\", MODE=\"0660\", TAG+=\"uaccess\"" > /etc/udev/rules.d/70-gardener-logitech.rules && udevadm control --reload && udevadm trigger --subsystem-match=hidraw'
systemctl --user restart gardener-pad
```
(While diverted the button no longer toggles the wheel's ratchet / free-spin.)
