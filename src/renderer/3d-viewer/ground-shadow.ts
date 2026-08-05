/**
 * Soft contact ground shadow (spec 3D-07) — shared by the interactive viewer
 * (slice C) and the offscreen thumbnail renderer (slice E).
 *
 * A directional light casts onto a ShadowMaterial plane sized to the model
 * bounds. No grid, no mesh — the model's contact conveys the ground (research
 * §3.2). The directional light also guarantees a minimum key light when the
 * HDRI environment fails to load, so a model never renders pure black.
 */

import { DirectionalLight, Mesh, PlaneGeometry, ShadowMaterial } from 'three';

export interface GroundShadowScene {
  add(...objects: unknown[]): void;
}

export interface GroundShadowBounds {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

/** Setup the contact shadow + key light for a model rooted at `groundY`. */
export function setupGroundShadow(
  scene: GroundShadowScene,
  bounds: GroundShadowBounds,
  groundY: number,
): void {
  const extent = Math.max(1, bounds.radius) * 1.6;
  const ground = new Mesh(
    new PlaneGeometry(extent * 2, extent * 2),
    new ShadowMaterial({ opacity: 0.28 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(bounds.center[0], groundY, bounds.center[2]);
  ground.receiveShadow = true;

  const light = new DirectionalLight(0xffffff, 1.1);
  light.position.set(
    bounds.center[0] + extent,
    bounds.center[1] + extent * 1.4,
    bounds.center[2] + extent,
  );
  light.target.position.set(bounds.center[0], groundY, bounds.center[2]);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = extent * 6;
  light.shadow.camera.left = -extent;
  light.shadow.camera.right = extent;
  light.shadow.camera.top = extent;
  light.shadow.camera.bottom = -extent;
  light.shadow.bias = -0.0005;

  scene.add(light, light.target, ground);
}
