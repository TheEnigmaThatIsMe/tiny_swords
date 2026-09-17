# Credits and third-party notices

## Artwork: Tiny Swords by Pixel Frog

All sprites, tiles, effects and UI art are from the **Tiny Swords** free pack by
[Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords), used under the
terms published on that page:

> Feel free to use this asset pack in both personal and commercial projects,
> modifying the assets as needed. Crediting is not required, but it helps and
> is always welcome. You may not redistribute, resell, or repackage the assets,
> even if the files are modified.

To respect that last clause, this repository does **not** contain the asset
pack. The game ships only `assets/atlas-0.png`, a build artifact holding the
trimmed frames the game actually draws, packed for loading. That atlas is part
of this game, not an asset pack: please do not extract it or reuse it as one.
If you want the art, download the pack from the link above.

The `Tiny Swords (Free Pack)/` folder is a build input only and is gitignored.
`tools/build_atlas.py` regenerates the atlas from it.

## Everything else

The code, the island generator, the procedural audio and the play-test tooling
are original work released under the MIT licence in `LICENSE`. There are no
other third-party dependencies.
