/*
 * Audio training modules for the Volunteers space.
 * Added once (the first time a LiveGenie with this file starts); after that they are ordinary pages
 * that editors can change, move or delete. Deleted modules do not come back.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KEY = 'training_audio_v1';
const BY = { id: null, name: 'LiveGenie' };

const pic = (name, caption) => ({ type: 'image', pic: name, caption });
const text = (md) => ({ type: 'text', md: md.trim() });
const tip = (md) => ({ type: 'callout', kind: 'tip', md: md.trim() });
const warn = (md) => ({ type: 'callout', kind: 'warning', md: md.trim() });
const crit = (md) => ({ type: 'callout', kind: 'critical', md: md.trim() });
const hr = { type: 'divider' };

// Listed in signal-flow order (the order a sound passes through a channel). Each page links to the next one.
const FLOW = ['Mic / DI', 'Gain', 'Filters', 'Gate', 'EQ', 'Compressor', 'Fader', 'Mix'];
const STEP = { gain: 'Gain', hpf: 'Filters', lpf: 'Filters', eq: 'EQ', comp: 'Compressor' };
const flowLine = (key) => '**Signal flow:** ' + FLOW.map((f) => (f === STEP[key] ? '**[ ' + f + ' ]**' : f)).join(' → ');
const MODULES = [
  {
    key: 'gain',
    title: 'Audio 1: Setting gain',
    blocks: [
      text(`
**About 10 minutes.** Gain is the first and most important knob on every channel. Get it right and everything after it is easy. Get it wrong and nothing after it can save the sound.

## What gain is
Gain sets **how much signal comes in** from a mic or DI. A pastor talking into a lav, a singer belting into a handheld and a keyboard line out all arrive at very different levels. Gain brings each one up (or down) to a healthy working level so every channel starts out equal.

The **fader** is a different thing: it sets **how much of that channel goes out** to the mix. Think of gain as how far you open the tap at the wall, and the fader as how far you open the tap at the sink.
`),
      pic('chain', 'Every channel follows the same path. Gain comes first, so it affects everything after it.'),
      text(`
## What you are aiming for
Watch the channel's input meter while the person sings, plays or talks **as loud as they will be during the service**. Turn gain until the loudest moments sit in the upper green and only just touch yellow. Never red.
`),
      pic('gain', 'Red means the preamp is clipping. Low green means you will be pushing faders to the top.'),
      text(`
## How to set it at soundcheck
1. Put the channel's fader at **0** (the thick line, called unity) and the master at its normal spot.
2. Press the channel's **Sel** key so you can see its gain and meter on the screen.
3. Ask the person to perform the loudest part of their set. "Sing the chorus like it's Easter" works better than "check, check".
4. Turn gain up until the loudest bits reach the top of the green and just tickle yellow.
5. If it hits red, turn it down 3 to 6 dB. Better a little low than clipping.
6. Now balance the mix with **faders**, not gain.

## Things that change gain
- **Phantom power (48V)** powers condenser mics and active DI boxes. Turn it on before setting gain. Mute the channel first, because switching it makes a pop.
- **Pad** knocks a very hot signal down (often 20 dB), for things like a kick drum or a hot keyboard. Use it if gain is all the way down and it still clips.
- **Different person, different gain.** A soft-spoken guest on the pastor's lav needs more gain than the pastor. Re-check whenever the person changes.
`),
      crit(`
**During a service, use the fader, not gain.** Gain feeds everything after it: the mains, wedges, in-ears and the livestream. Turning gain up to make someone louder in the room also makes them louder in every monitor and on the stream. If a channel is clipping mid-service, turn it down a little and tell the tech lead afterwards.
`),
      tip(`
**Our setup:** inputs come in on the stage box and the gain is set from the SQ-5. The stage box has no gain knobs of its own, so all gain changes happen at the desk.
`),
      text(`
## Practise it
1. Put on headphones and press the channel's **PAFL** key to listen to it alone.
2. Turn gain far too low, then far too high (with the fader down so the room hears nothing). Listen to the hiss when it's low and the crunch when it clips.
3. Set it properly using the steps above, then compare.

## Check yourself
1. Someone is too quiet in the room during the sermon. Do you reach for gain or the fader?
2. The meter flashes red on the loudest notes. What do you do?
3. Why does changing gain mid-service bother the band?
`),
      tip(`
**Answers:** 1. The fader. 2. Turn gain down until the loudest notes stay out of the red. 3. Gain changes their wedges and in-ears too, not just the room.
`)
    ]
  },
  {
    key: 'hpf',
    title: 'Audio 2: High pass filter',
    blocks: [
      text(`
**About 8 minutes.** The high pass filter is the easiest way to make a mix sound cleaner. Most channels should have it on.

## What it does
A high pass filter **lets the high frequencies pass and cuts the low ones**. The name describes what gets through, not what gets cut. (Some desks call it a low cut. Same thing.)

Below the frequency you set, the sound gets quieter and quieter. Above it, nothing changes.
`),
      pic('hpf', 'With the high pass at 100 Hz, the rumble below it fades away and the voice above it is untouched.'),
      text(`
## Why we use it
Almost every mic picks up low rumble that isn't part of the sound you want: feet on the stage, air conditioning, handling noise, wind from someone's breath, the kick drum and bass bleeding into a vocal mic. A voice has almost nothing useful down there, so cutting it costs nothing and takes away mud and boom.

All that extra low end also eats amplifier and speaker power, and the subs and bass guitar need that space.

## The two controls
- **Frequency:** where the cut starts. Higher cuts more.
- **Slope:** how steep the cut is, in dB per octave. 12 dB per octave is gentle; 24 is steep. If your desk only shows frequency, the slope is fixed and that's fine.

## Where to start
| Source | Start the high pass around |
|---|---|
| Speaking voice, pastor's lav, headset | 100 to 150 Hz |
| Singing vocal | 80 to 120 Hz |
| Acoustic guitar | 80 to 100 Hz |
| Electric guitar amp | 80 to 100 Hz |
| Keys and piano | 40 to 80 Hz |
| Drum overheads | 150 to 300 Hz |
| Kick drum, cajon low mic | 30 to 50 Hz |
| Bass guitar | 30 to 40 Hz, or off |

These are starting points. Use your ears.

## How to set it by ear
1. Listen to the channel in headphones with **PAFL**.
2. Turn the high pass on and slowly raise the frequency.
3. At first you hear the rumble go away and it gets cleaner. Keep going.
4. When the voice or instrument starts to sound thin, like a phone call, back it off a little.
`),
      warn(`
**Don't overdo it on deep voices or bass instruments.** A deep male voice at 150 Hz can lose its warmth. Bass guitar and kick drum *need* their lows, so keep their high pass very low or off.
`),
      tip(`
**The lav trick:** the pastor's lav picks up chest thumps, clothing rustle and the stage. A higher high pass (around 120 to 150 Hz) cleans it up and makes the sermon clearer, and it also helps stop low feedback.
`),
      text(`
## Check yourself
1. Does a high pass filter cut the highs or the lows?
2. You hear a low thump every time the worship leader steps on the stage. What do you try first?
3. Should the bass guitar have a high pass at 120 Hz?
`),
      tip(`
**Answers:** 1. The lows. It lets the highs pass. 2. Raise the high pass on their vocal mic. 3. No. That would cut the notes it plays; keep it at 30 to 40 Hz or off.
`)
    ]
  },
  {
    key: 'lpf',
    title: 'Audio 3: Low pass filter',
    blocks: [
      text(`
**About 5 minutes.** The low pass filter is the mirror image of the high pass. You will use it far less often.

## What it does
A low pass filter **lets the low frequencies pass and cuts the high ones**. Above the frequency you set, the sound gets quieter and quieter. Below it, nothing changes. (Some desks call it a high cut.)
`),
      pic('lpf', 'With the low pass at 6 kHz, the bass keeps its notes and loses the hiss and string noise above.'),
      text(`
## When to use it
- **Bass guitar and kick drum:** takes away hiss, finger and string noise, and the click of a kick when you only want the thump.
- **Electric guitar amps:** tames harsh fizz from distortion.
- **Anything noisy:** an old DI or a hissy keyboard output.

## When to leave it off
Vocals, acoustic guitar, cymbals and anything that needs to sound clear and bright. These all live up high. A low pass on a vocal makes the words dull and hard to understand.

## Where to start
| Source | Start the low pass around |
|---|---|
| Bass guitar | 5 to 8 kHz |
| Kick drum (for just the thump) | 5 to 8 kHz |
| Electric guitar amp | 8 to 12 kHz |
| Vocals, acoustic, cymbals, keys | Off |

Set it the same way as the high pass, from the other end: lower it slowly until you hear the sound lose something it needs, then back it off.
`),
      tip(`
**No low pass on the channel?** Use the top band of the EQ as a high shelf turned down a few dB. It does a similar job.
`),
      text(`
## Check yourself
1. Does a low pass filter cut the highs or the lows?
2. Why would you not put a low pass on the pastor's lav?
`),
      tip(`
**Answers:** 1. The highs. It lets the lows pass. 2. Speech clarity lives in the highs; cutting them makes the sermon hard to understand.
`)
    ]
  },
  {
    key: 'eq',
    title: 'Audio 4: How EQ works',
    blocks: [
      text(`
**About 12 minutes.** EQ (equalisation) is a set of tone controls, like bass and treble on a car stereo, but much more precise.

## What it does
EQ **turns specific frequencies up or down**. Every sound is a mix of low, middle and high frequencies. EQ lets you turn down the part that sounds bad (boomy, boxy, harsh) or gently turn up the part that is missing (clarity, warmth).

Our desk has a four-band EQ on every channel. Each band has three controls:
- **Frequency:** which part of the sound you are working on, from 20 Hz (lowest) to 20 kHz (highest).
- **Gain:** how much you turn it up (+) or down (−).
- **Width (Q):** how wide a range around that frequency you affect. Narrow is surgical; wide is gentle and musical.
`),
      pic('eq', 'A typical vocal: high pass to clear the rumble, a narrow cut to take out mud, and a wide lift to help the words cut through.'),
      text(`
## What each range sounds like
| Range | What lives there | Too much sounds | Too little sounds |
|---|---|---|---|
| 20 to 60 Hz (sub) | Felt more than heard: kick, bass | Rumbly, boomy | Weak |
| 60 to 250 Hz (low) | Warmth and body | Boomy | Thin |
| 250 to 500 Hz (low mid) | Mud and boxiness | Muddy, boxy, cardboard | Hollow |
| 500 Hz to 2 kHz (mid) | Honk | Honky, nasal, like a phone | Scooped, distant |
| 2 to 5 kHz (presence) | Clarity, consonants, words | Harsh, piercing | Muffled |
| 5 to 10 kHz (brilliance) | S sounds, cymbals, pick attack | Sizzly, spitty | Dull |
| 10 to 20 kHz (air) | Sparkle and air | Hissy | Closed in |

## Four rules that will keep you out of trouble
1. **Cut before you boost.** If a vocal isn't clear, the answer is usually to take away the mud around 250 to 500 Hz, not to add more top.
2. **Cut narrow, boost wide.** Cut problems with a narrow band. Lift good things with a wide, gentle band.
3. **Small moves.** 2 to 4 dB is a lot. If you are past 6 dB, something earlier (mic choice, placement, gain) probably needs fixing.
4. **Use your ears, not your eyes.** A strange-looking curve that sounds great is right. A pretty curve that sounds bad is wrong.

## Finding a problem frequency
1. Listen in headphones with **PAFL**, with the fader down in the room.
2. Take one band, make it narrow, and boost it a lot (around +9 dB).
3. Slowly sweep the frequency until the bad sound jumps out at you (the boom, the box, the harshness).
4. Turn that same band from a boost into a cut of 3 to 6 dB.
5. Widen it a little until the problem is gone, and compare with the EQ switched in and out.
`),
      crit(`
**Never sweep a big boost on a live channel in the room.** A narrow +9 dB boost can start feedback in a second. Do it in headphones with the fader down, or before people arrive.
`),
      tip(`
**Good starting points:** vocal muddy → cut around 300 Hz. Vocal hard to understand → wide lift of 2 to 3 dB around 3 kHz. Acoustic guitar boomy → cut around 200 Hz. Kick drum like a cardboard box → cut around 400 Hz.
`),
      warn(`
**Feedback is not an EQ-on-the-channel job.** Ringing or squealing from the wedges or mains is handled by the system processing that the tech team set up. Pull the fader down first, then tell the tech lead which mic and which speaker.
`),
      text(`
## Check yourself
1. A vocal sounds muddy. Do you boost the highs or cut the low mids?
2. Should a cut for a problem be narrow or wide?
3. You've boosted 10 dB at 3 kHz to make someone audible. What does that tell you?
`),
      tip(`
**Answers:** 1. Cut the low mids (around 250 to 500 Hz). 2. Narrow. 3. Something earlier needs fixing: gain, mic position or the fader level. Back the EQ off and look there.
`)
    ]
  },
  {
    key: 'comp',
    title: 'Audio 5: How a compressor works',
    blocks: [
      text(`
**About 12 minutes.** A compressor is an automatic hand on the fader. It turns a channel down when it gets loud, so the quiet parts and the loud parts end up closer together.

## Why we use it
A singer goes from a soft verse to a big chorus. A pastor goes from a whisper to a shout. Without a compressor you are riding the fader constantly; with one, the loud moments are held back and the channel sits steadily in the mix. It also protects the livestream from sudden loud peaks.
`),
      pic('comp', 'Below the threshold the compressor does nothing. Above it, at 4:1, every 4 dB louder going in comes out only 1 dB louder.'),
      text(`
## The controls
- **Threshold:** the level where it starts working. Anything quieter passes untouched. Lower threshold means it works more often.
- **Ratio:** how hard it pushes back once the signal is over the threshold. 2:1 is gentle, 4:1 is firm, 10:1 and up is basically a wall (a limiter).
- **Attack:** how quickly it grabs a loud sound, in milliseconds. Fast attack catches everything; a bit slower lets the start of a note or drum hit through, which keeps it punchy.
- **Release:** how quickly it lets go after the loud part ends. Too fast sounds pumpy; too slow keeps the channel squashed into the next quiet part.
- **Make-up gain:** because the compressor turns the loud parts down, the whole channel ends up a bit quieter. Make-up gain brings it back up.
- **GR meter (gain reduction):** shows how many dB it is turning down right now. **This is the meter to watch.**

## How much is right
Watch the gain reduction meter during the loudest parts:
- **2 to 4 dB:** gentle, you will barely hear it. Good for most things.
- **4 to 6 dB:** firm control. Good for vocals and the pastor.
- **More than 8 dB, all the time:** too much. It starts to sound flat and lifeless.

## Where to start
| Source | Ratio | Gain reduction on loud parts | Attack | Release |
|---|---|---|---|---|
| Pastor's lav or headset | 3:1 | 3 to 6 dB | 10 ms | 150 ms |
| Lead vocal | 3:1 to 4:1 | 3 to 6 dB | 5 to 10 ms | 100 ms |
| Backing vocals | 3:1 | 3 to 5 dB | 5 to 10 ms | 100 ms |
| Acoustic guitar | 2:1 to 3:1 | 2 to 4 dB | 10 to 20 ms | 100 ms |
| Bass guitar | 4:1 | 3 to 6 dB | 10 to 30 ms | 150 ms |
| Kick drum | 4:1 | 3 to 6 dB | 10 to 30 ms | 80 ms |

## How to set it
1. Start with the ratio and attack and release from the table.
2. Have them sing or speak at their loudest. Lower the threshold until the GR meter shows about 3 to 6 dB on the loud parts and nothing on the quiet parts.
3. Switch the compressor in and out. The loud parts should be calmer and the channel should still sound natural.
4. Add make-up gain so it's about as loud with the compressor in as it was without.
`),
      warn(`
**Too much compression causes feedback.** Squashing a channel hard brings its quiet parts up, which includes the room and the speakers it can hear. The pastor's lav is the most likely to ring. If it starts to feed back, ease off the compressor before anything else.
`),
      tip(`
**Order matters:** gain first, then the high pass and EQ, then the compressor. If gain is wrong, the threshold you set today will be wrong next week.
`),
      text(`
## Check yourself
1. What does the threshold do?
2. The GR meter on the worship leader's vocal shows 12 dB of reduction all the time. Is that good?
3. After setting the compressor the vocal is quieter overall. What do you turn up?
`),
      tip(`
**Answers:** 1. It sets the level where the compressor starts working. 2. No. Raise the threshold (or lower the ratio) until it's around 3 to 6 dB on the loud parts. 3. Make-up gain.
`)
    ]
  }
];

const START = {
  title: 'Audio training: start here',
  intro: `
New to the sound desk? Work through these modules in order. They follow the signal flow: the order a sound passes through every channel on the desk, from the mic to the mix. Each one takes about 10 minutes, ends with a few check-yourself questions and has something to practise at the desk. Our desk is an **Allen & Heath SQ-5**, but the ideas work on any mixer.
`,
  outro: `
**About the gate:** it sits between the filters and the EQ and mutes a channel when nobody is using it (between drum hits, for example). We rarely use one on vocals or the pastor, so it is left out of these modules. Leave gates as the tech team set them.

## Before you practise
- Practise before people arrive, or in headphones with the channel's **PAFL** key and the fader down.
- Never change gain, EQ or compression on a live channel during worship or the sermon without asking the tech lead.
- Something sounds wrong and you don't know why? Pull the fader down a little, and ask. That is always the right answer.
`
};

/** PNG width and height from its header. */
function pngSize(buf) {
  return buf.length > 24 && buf.toString('ascii', 12, 16) === 'IHDR' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
}

/** Add the audio training pages to the Volunteers space, once. */
function seed(store) {
  if (store.getSetting(KEY)) return null;
  if (!store.spaceBySlug('volunteers')) { store.setSetting(KEY, 'no volunteers space'); return null; }
  const dir = path.join(__dirname, 'training');
  const pics = {};
  const picture = (name) => {
    if (!pics[name]) {
      const buf = fs.readFileSync(path.join(dir, name + '.png'));
      pics[name] = store.saveUpload(buf, 'image/png', BY, pngSize(buf)).id;
    }
    return pics[name];
  };
  const blocks = (list) => list.map((b) => (b.type === 'image' ? { type: 'image', upload: picture(b.pic), caption: b.caption } : b));

  // Created last to first so each page can link to the next one.
  const ids = {};
  let next = null;
  for (const m of MODULES.slice().reverse()) {
    const body = [text(flowLine(m.key))].concat(blocks(m.blocks));
    if (next) body.push(hr, text(`**Next:** [${next.title}](#/p/${next.id})`));
    ids[m.key] = store.createPage({ title: m.title, space: 'volunteers', blocks: body }, BY);
    next = { id: ids[m.key], title: m.title };
  }
  const list = MODULES.map((m, i) => `${i + 1}. [${m.title.replace(/^Audio \d+: /, '')}](#/p/${ids[m.key]})`).join('\n');
  const startBlocks = [
    text(START.intro),
    pic('chain', 'The path every sound takes through the desk. The modules follow it from left to right.'),
    text('## Modules\n' + list),
    text(START.outro)
  ];
  const start = store.createPage({ title: START.title, space: 'volunteers', blocks: blocks(startBlocks), pinned: true }, BY);
  store.setSetting(KEY, String(start));
  return start;
}

module.exports = { seed, MODULES };
