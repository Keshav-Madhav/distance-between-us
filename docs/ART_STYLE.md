# Art style: The Distance Between Us

The world is built to be read at Mach 6. It's clean and sharp, with bold colour and clear silhouettes.
It is stylized rather than gritty. Surfaces still carry rich, high-resolution detail up close (the sand
grain and rock layers you read your speed from), graded hot and saturated.

- **Palette:** burnt orange sand, red and rust sandstone with cream bands, pale cracked clay in the
  dry riverbeds. A deep, saturated blue sky that turns pale and warm at the horizon. Glowing orange-white
  thrusters, cyan hover light. Enemies are dark gunmetal with red glows.
- **Light:** a high, hard desert sun with warm highlights and cool, blue-lifted shadows, plus a warm haze
  low on the horizon.
- **Materials:** wind-rippled sand, layered sandstone with desert varnish streaks, sun-baked mud
  polygons. The craft is pearl-white clearcoat with carbon and orange accents.
- **Detail:** high-frequency grain and pebbles near the camera fade into flat colour fields at
  distance, so the far land reads as shapes.
- **Mood:** freedom, heat, too fast.

## Prompt core

High-resolution, crisp, richly detailed natural desert material, slightly stylized: clean, vivid and
saturated colour (burnt orange, rust red, cream), high contrast, like a premium modern stylized-realistic
video game such as a AAA racing game. Colour palette: burnt orange sand #D9824A, rust red rock #9E3A1E,
cream bands #E8C49A, deep shadows tinted warm brown, never grey. No people, no vehicles, no plants unless asked, no text.

## Asset log

`assets/raw/*.json` holds the prompt and model for each generated image. `tools/process-textures.mjs`
makes each one seamless, verifies it by tiling, derives a normal map, resizes it to a power of two and
writes it to `public/tex/`.
