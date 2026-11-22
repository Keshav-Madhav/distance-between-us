// The night sky, one for everywhere: stars, the Milky Way, far nebulae and galaxies — as a function of
// a direction in the star system's frame. ORBIT draws it directly; a world's space view rotates its
// own directions into that frame first (uSkyM, handed over with the ship), so the sky you fly down
// through is the one you saw from orbit, star for star. Needs fbmT (tNoise) from the host.
export const SKY_GLSL_SHARED = /* glsl */ `
        vec3 sky_h3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
        // Noise on the sphere of directions: three projections blended by the direction.
        float sky_tri(vec3 n, float s, float o) {
          vec3 w = abs(n); w = w * w; w /= (w.x + w.y + w.z);
          return fbmT(n.yz * s + o) * w.x + fbmT(n.zx * s + o * 1.7) * w.y + fbmT(n.xy * s + o * 2.3) * w.z;
        }
        // Stars: three layers of cells; most empty, the rest one star about a pixel wide, a steep power
        // law in brightness (a few bright, most faint), tinted by temperature.
        vec3 sky_stars(vec3 d) {
          vec3 acc = vec3(0.0);
          for (int k = 0; k < 3; k++) {
            float S = k == 0 ? 120.0 : k == 1 ? 300.0 : 700.0;
            vec3 p = d * S, c = floor(p), h = sky_h3(c + float(k) * 17.0);
            if (h.z > (k == 0 ? 0.012 : k == 1 ? 0.009 : 0.007)) continue;
            vec3 sp = c + 0.2 + 0.6 * sky_h3(c + 2.7);
            float px = max(length(fwidth(p)), 1e-4);
            float w = length(p - sp) / px;
            float m = pow(sky_h3(c + 4.1 + float(k)).x, 9.0);
            vec3 tint = mix(vec3(1.0), mix(vec3(1.0, 0.78, 0.6), vec3(0.75, 0.85, 1.0), sky_h3(c + 9.3).y), 0.35);
            acc += tint * (0.04 + m) * exp(-w * w * 1.3) * (k == 0 ? 2.5 : k == 1 ? 0.9 : 0.4);
          }
          return acc;
        }
        // The Milky Way: a band along a tilted great circle, clumpy, cut by dust lanes, a warm core.
        vec3 sky_galaxy(vec3 d) {
          vec3 nG = normalize(vec3(0.35, 0.62, -0.7));
          float b = dot(d, nG);
          float band = exp(-b * b / 0.012) + 0.35 * exp(-b * b / 0.08);
          if (band < 0.002) return vec3(0.0);
          float clump = sky_tri(d, 9.0, 1.0) * 0.6 + sky_tri(d, 31.0, 5.0) * 0.4;
          float dust = smoothstep(0.5, 0.7, sky_tri(d, 18.0, 9.0)) * exp(-b * b / 0.004);
          vec3 core = normalize(vec3(-0.6, -0.2, -0.75));
          float ck = pow(max(dot(d, core), 0.0), 6.0);
          vec3 col = mix(vec3(0.55, 0.6, 0.8), vec3(1.0, 0.84, 0.62), ck);
          return col * band * (0.35 + clump) * (1.0 - 0.6 * dust) * (0.05 + 0.14 * ck);
        }
        // Far nebulae: a few wispy clouds of colour across the sky (emission reds and magentas, teal
        // oxygen, dusty amber), shaped by folded noise, each in its own region; and small far galaxies.
        vec3 sky_nebulae(vec3 d) {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 6; i++) {
            float fi = float(i);
            vec3 c = normalize(sky_h3(vec3(fi * 7.3, 2.1, fi + 0.4)) * 2.0 - 1.0);
            float a = dot(d, c);
            float reach = 0.5 + 0.25 * sky_h3(vec3(fi, 9.0, 3.0)).x;
            if (a < reach) continue;
            float k = smoothstep(reach, reach + 0.3, a);
            float f = sky_tri(d, 5.0 + fi, 3.0 + fi * 2.0);
            float g = sky_tri(d + f * 0.25, 14.0, 7.0 + fi);
            float body = f * 0.65 + g * 0.35;
            float wisp = smoothstep(0.4, 0.8, body) * k;
            // Brighter, billowing cores (soft: a contour-line edge read as a topographic map).
            float core = smoothstep(0.62, 0.9, body) * smoothstep(0.45, 0.75, g) * k;
            int j = i - (i / 4) * 4;
            vec3 c1 = j == 0 ? vec3(0.95, 0.25, 0.45) : j == 1 ? vec3(0.2, 0.75, 0.8) : j == 2 ? vec3(0.95, 0.6, 0.3) : vec3(0.55, 0.35, 0.95);
            vec3 c2 = j == 0 ? vec3(0.45, 0.35, 0.95) : j == 1 ? vec3(0.35, 0.95, 0.6) : j == 2 ? vec3(0.95, 0.35, 0.3) : vec3(0.25, 0.6, 0.95);
            vec3 col = mix(c1, c2, smoothstep(0.3, 0.7, g));
            acc += col * (wisp * 0.11 + core * 0.16);
          }
          // A faint wash of colour across the whole sky (No Man's Sky's skies are never flat black).
          float wash = sky_tri(d, 1.6, 11.0);
          acc += mix(vec3(0.05, 0.02, 0.09), vec3(0.01, 0.06, 0.08), smoothstep(0.3, 0.7, sky_tri(d, 2.3, 4.0))) * smoothstep(0.35, 0.75, wash) * 0.45;
          // Far galaxies: a handful of tiny tilted smudges with bright cores.
          vec3 p = d * 40.0, cc = floor(p), h = sky_h3(cc + 51.0);
          if (h.x < 0.035) {
            vec3 q = p - (cc + 0.5);
            float r = length(q - d * dot(q, d));
            acc += mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.82, 1.0), h.y) * (exp(-r * r * 220.0) * 0.6 + exp(-r * r * 30.0) * 0.06);
          }
          return acc;
        }
        vec3 skyBack(vec3 d) { return sky_stars(d) + sky_galaxy(d) + sky_nebulae(d); }
`
