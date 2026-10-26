# Shadow command and Gemini capability inventory

This inventory is based on `src/commands/registry.js`, the source used to render `.menu`. The Gemini registry is intentionally smaller than the command registry: Gemini receives only safe, explicitly implemented capabilities and never receives arbitrary command handlers.

## Commands shown by `.menu`

The current menu command registry contains these 83 commands:

```text
addsudo admins alive anibattle anime animegenre animepopular animequiz
animequote animesong antidelete antilink bite bonk broadcast calculate
character clear cry define delete delsudo demote disablecmd enablecmd fb
greet group groupinfo help hidetag hmph hug info insta invite joinrequest
kick kiss manga media menu mute neko owner pat ping play promote qr quote
recommend reload resetwarnings revokeinvite rules runtime seasonal
setdescription setgoodbye setname setrules setwelcome shortlink
slap slowmode stats sticker sudos support tagall tiktok toimage tomp3
translate twitter unmute waifu warn warnings weather yta ytv
```

The reaction, downloader, and participant-action entries generated from command families are included in the count above.

## Gemini tools currently available

These are real service-backed tools, not wrappers that invoke arbitrary prefix commands:

| Gemini tool | Existing implementation | Related menu commands |
|---|---|---|
| `calculate` | Safe arithmetic parser | `.calculate` |
| `remember`, `recall_memories`, `forget_memory`, `clear_memories` | Explicit per-sender persistent memory operations | Natural-language memory requests |
| `define_word` | Dictionary lookup service | `.define` |
| `weather` | Weather lookup service | `.weather` |
| `search_anime` | Anime search service | `.anime` |
| `search_manga` | Manga search service | `.manga` |
| `search_character` | Character search service | `.character` |
| `recommend_anime` | Anime recommendation service | `.recommend` |
| `popular_anime` | Popular anime service | `.animepopular` |
| `anime_by_genre` | Anime genre service | `.animegenre` |
| `anime_quote` | Local anime quote service | `.animequote` |
| `search_images` | Approved anime/character image metadata search with source URLs | Natural-language image requests |
| `make_image_stickers` | Validated image download, static sticker conversion, and actual Baileys delivery | Natural-language image-to-sticker requests |
| `send_reaction_stickers` | Existing validated reaction-sticker loader/sender | `.hug`, `.slap`, `.kiss`, `.pat`, `.bonk`, `.cry`, `.bite`, `.hmph` |

Tool selection is prompt-specific. Ordinary chat and greetings omit the `tools` request field entirely. A request about anime, for example, receives only the relevant anime search/recommendation tools rather than the complete registry.

## Commands deliberately not exposed to Gemini yet

The following remain available through their normal prefix commands but are not AI tools because they involve owner/admin authorization, destructive actions, media context, downloads, external side effects, or stateful workflows that need additional safeguards:

- Owner and account administration: `.addsudo`, `.delsudo`, `.sudos`, `.stats`, `.reload`, `.broadcast`, `.owner`.
- Group administration and moderation: `.admins`, `.groupinfo`, `.greet`, `.rules`, `.warnings`, `.kick`, `.promote`, `.demote`, `.tagall`, `.hidetag`, `.antilink`, `.antidelete`, `.mute`, `.unmute`, `.slowmode`, `.delete`, `.clear`, `.disablecmd`, `.enablecmd`, `.setname`, `.setdescription`, `.invite`, `.revokeinvite`, `.joinrequest`, `.group`, `.setwelcome`, `.setgoodbye`, `.setrules`, `.warn`, `.resetwarnings`.
- Media conversion and message-context operations: `.sticker`, `.toimage`, `.tomp3`, `.media`, `.qr`.
- Downloads and external media workflows: `.animesong`, `.yta`, `.ytv`, `.play`, `.tiktok`, `.insta`, `.fb`, `.twitter`.
- Stateful or presentation-only commands: `.animequiz`, `.anibattle`, `.seasonal`, `.waifu`, `.neko`, `.translate`, `.shortlink`, `.ping`, `.alive`, `.runtime`, `.info`, `.menu`, `.help`, `.quote`, `.support`.

In particular, Gemini cannot currently create, convert, save, or register new sticker artwork. `send_reaction_stickers` only sends existing validated assets.

`make_image_stickers` converts retrieved existing images into static stickers; it does not generate new artwork. Pinterest scraping and unauthenticated CAPTCHA/access-control bypass are not implemented. The image provider interface can accept an authorized Pinterest provider later without changing the sticker pipeline.
