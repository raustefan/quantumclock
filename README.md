<img src="assets/icon.svg" width="64" height="64" alt="">

# A clock made from one atom

An interactive 3D simulation of the ²⁷Al⁺ quantum-logic clock at NIST, in twelve steps, from the trap to the final frequency budget. Parameters come from the published experiments, and the last step of the site lists every approximation and every disagreement with the data.

```
npm install
npm run dev     # http://localhost:3000
npm test        # 17 checks of the physics engine against analytic results and published data
```

- `lib/physics/` is the engine, independent of the UI. `constants.ts` cites the source of every input.
- `components/Scene.ts` is the Three.js instrument, where one world unit is one micrometre.
- `components/stages-*.tsx` are the steps.
