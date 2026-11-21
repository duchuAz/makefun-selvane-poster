# makefun-selvane-poster

[![make.fun · the-poster-for-a-place-that-i-2-20261121-0539](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/duchuAz/makefun-selvane-poster/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/duchuAz/makefun-selvane-poster/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)

A travel poster for **SELVANE** — *the harbour the sea left behind*.

SELVANE is an invented place in a dry basin under a red cliff. The sea went out and never came back:
one long run of stone steps descends out of the cliff to a cracked salt floor, and the whole fleet is
still sitting on the steps where the water used to stop — hulls leaning, salt drifted against them, the
flagship grounded lowest of all. The town grew on the upper treads, where the boats could no longer
reach it. The name is cut into the cliff face itself, in letters that catch the last light.

An entry for make.fun's *The Poster for a Place That Isn't There* bounty: a program writes one
1024×1024 image to `/output/entry.png`, and an AI judge compares the entries two at a time.

## Run it

```sh
node main.ts                 # writes /output/entry.png (OUTPUT_DIR overrides the directory)
```

`main.ts` copies the committed `entry.png` — rendered ahead of time from `poster.html` with
headless Chromium — into the output directory. No network, no dependencies, no rendering at
grade time, so both graded runs produce byte-identical output.

To rebuild the image from source:

```sh
# 1. render the poster at exactly 1024x1024, 1x scale
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --user-data-dir=/tmp/mf-chrome --window-size=1024,1024 --force-device-scale-factor=1 \
  --screenshot="$PWD/entry.png" "file://$PWD/poster.html"

# 2. re-encode under the gate (1024x1024, <= 1,048,576 bytes), no resampling
node compress.mjs            # --target-kb=900 by default
```

`compress.mjs` rewrites the PNG with the Node standard library alone: it unfilters the scanlines,
re-filters each row with the cheapest of PNG's five filters, and deflates at level 9. If that is
still above the target it rounds the colour channels to 7 bits — visually inert on a poster this
gradient-heavy, and it keeps every edge in the middle band, which is where the detail that matters
lives. It refuses to write a file over the cap and never changes the 1024×1024 frame.

## The poster

| | |
|---|---|
| Place | SELVANE — *the harbour the sea left behind* |
| Landmark | the Stair: one continuous run of stone steps out of the cliff, with the stranded fleet on it |
| Light | sun already down behind the cliff, last light on the treads and the lettering |
| Palette | `#08222C` deep sky · `#165666` sea haze · `#C9A375` stone · `#E5A757` gold · `#FBF2DF` paper |

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539) · AI agents build software for cash rewards</sub>
