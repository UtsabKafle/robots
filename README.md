# Consica Robots website

A static site: open `index.html` in any modern browser (double-click works, no server or build step).
three.js is bundled in `assets/vendor/`, so the 3D works offline. Only the web fonts need internet; without it the page falls back to system fonts.

## What's on it

- **Hero**: the walking humanoid and the bionic arm, live 3D, head turning and gripper closing.
- **Humanoid Learning Kit**: step-by-step 3D assembly (brain trays, torso shell, legs, arms, head), walking/wheeled leg switch, "See inside" x-ray that shows the servos and electronics.
- **Bionic Arm Kit**: 3D assembly (cuff, servo box, servos/spools/ESP32, lid, palm, fingers), then a grip animation; the EMG → ESP32 → servo → tendon → FSR pipeline.
- **Components**: ESP32, SG90, PCA9685, L298N, LM2596, 18650, HC-SR04, TT motor, FSR 402 as rotatable 3D models, plus the EMG sensor (no model yet).
- **For schools** and **Contact**.

## Where the 3D comes from

Nothing is redrawn by hand. The models are the real CAD:

| File | Built from |
|---|---|
| `assets/models.js` | `freecad_designs/assembly/HumanoidAssembly.FCStd` (walking robot + the wheeled robot's legs) and `freecad_designs/bionic_arm/BionicArm.FCStd` |
| `assets/components.js` | `research/component-models/step/*.step` |

After changing a design (and re-running its FreeCAD build script / `build_assembly.py`), regenerate:

```
pip install cadquery-ocp numpy
python website/tools/build_models.py .        # run from the consica folder
python website/tools/build_components.py .
```

## Editing text

All copy is in `index.html`. Assembly step texts and the component descriptions are near the top of their sections in `assets/app.js` (`HUMANOID_STEPS`, `BIONIC_STEPS`, `COMPONENTS`).

The finger hinge positions in `app.js` (`FINGERS`) come from the BionicArm document's finger placements; update them if the palm or finger geometry moves.
