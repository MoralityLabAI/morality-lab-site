import { el } from '../dom';
import { Store } from '../store';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { openManifoldWindow, sendStoryworldToManifold } from '../manifoldBridge';

let autoOpenedManifold = false;

type AxisKey = 'index' | 'options' | 'reactions' | 'effects' | { propId: string };

const axisLabel = (axis: AxisKey, store: Store): string => {
  if (axis === 'index') return 'Encounter Index';
  if (axis === 'options') return 'Option Count';
  if (axis === 'reactions') return 'Reaction Count';
  if (axis === 'effects') return 'Effect Count';
  const prop = store.getState().storyworld.authored_properties.find((p) => p.id === axis.propId);
  return prop?.property_name || axis.propId;
};

const axisValue = (axis: AxisKey, encounterIndex: number, store: Store): number => {
  const storyworld = store.getState().storyworld;
  const encounter = storyworld.encounters[encounterIndex];
  if (!encounter) return 0;
  if (axis === 'index') return encounterIndex;
  if (axis === 'options') return encounter.options.length;
  if (axis === 'reactions') {
    return encounter.options.reduce((sum, option) => sum + option.reactions.length, 0);
  }
  if (axis === 'effects') {
    let count = 0;
    for (const option of encounter.options) {
      for (const reaction of option.reactions) {
        const afterCount = reaction.after_effects?.length ?? 0;
        count += afterCount || (reaction.effects?.length ?? 0);
      }
    }
    return count;
  }
  // For authored properties, use first character's property value if present.
  const character = storyworld.characters[0];
  if (!character) return 0;
  return character.bnumber_properties.get(axis.propId) ?? 0;
};

export function renderGraphViewTab(store: Store): HTMLElement {
  if (!autoOpenedManifold) {
    autoOpenedManifold = true;
    openManifoldWindow();
    sendStoryworldToManifold(store.getState().storyworld);
  }
  const storyworld = store.getState().storyworld;
  const container = el('div', { className: 'sw-graph-view' });
  const toolbar = el('div', { className: 'sw-graph-toolbar' });
  const axisTabs = el('div', { className: 'sw-axis-tabs' });
  const axisSelectWrap = el('div', { className: 'sw-axis-select' });
  const axisReadout = el('div', { className: 'sw-axis-readout' });
  const presetWrap = el('div', { className: 'sw-axis-select' });
  const legend = el('div', { className: 'sw-graph-legend' });
  const openButton = el('button', { text: 'Open Manifold Window' });

  const axisOptions: AxisKey[] = [
    'index',
    'options',
    'reactions',
    'effects',
    ...storyworld.authored_properties.map((prop) => ({ propId: prop.id })),
  ];

  const makeAxisSelect = (label: string, selected: AxisKey) => {
    const wrapper = el('div', { className: 'sw-axis-group' });
    const select = el('select') as HTMLSelectElement;
    axisOptions.forEach((axis, index) => {
      const value = typeof axis === 'string' ? axis : `prop:${axis.propId}`;
      const opt = el('option', { text: axisLabel(axis, store), attrs: { value } }) as HTMLOptionElement;
      const selectedValue = typeof selected === 'string' ? selected : `prop:${selected.propId}`;
      if (selectedValue === value) opt.selected = true;
      select.appendChild(opt);
    });
    wrapper.append(el('label', { text: label }), select);
    return { wrapper, select };
  };

  let xAxis: AxisKey = axisOptions[0];
  let yAxis: AxisKey = axisOptions[1] || axisOptions[0];
  let zAxis: AxisKey = axisOptions[2] || axisOptions[0];

  const axisSelect = makeAxisSelect('Axis', xAxis);
  axisSelectWrap.append(el('label', { text: 'Axis Variable' }), axisSelect.select);

  type Preset = { name: string; axes: { x: AxisKey; y: AxisKey; z: AxisKey } };
  const presets: Preset[] = [
    { name: 'Index / Options / Reactions', axes: { x: 'index', y: 'options', z: 'reactions' } },
    { name: 'Options / Reactions / Effects', axes: { x: 'options', y: 'reactions', z: 'effects' } },
  ];
  if (storyworld.authored_properties.length >= 2) {
    presets.push({
      name: 'Prop 1 / Prop 2 / Index',
      axes: {
        x: { propId: storyworld.authored_properties[0].id },
        y: { propId: storyworld.authored_properties[1].id },
        z: 'index',
      },
    });
  }

  const presetSelect = el('select') as HTMLSelectElement;
  presets.forEach((preset, index) => {
    const opt = el('option', { text: preset.name, attrs: { value: `${index}` } }) as HTMLOptionElement;
    presetSelect.appendChild(opt);
  });
  presetWrap.append(el('label', { text: 'Presets' }), presetSelect);

  type AxisSlot = 'x' | 'y' | 'z';
  let activeAxis: AxisSlot = 'x';
  let axisState = { x: xAxis, y: yAxis, z: zAxis };

  const updateReadout = () => {
    axisReadout.textContent = `X: ${axisLabel(axisState.x, store)} | Y: ${axisLabel(axisState.y, store)} | Z: ${axisLabel(axisState.z, store)}`;
  };

  const updateSelectValue = () => {
    const current = axisState[activeAxis];
    axisSelect.select.value = typeof current === 'string' ? current : `prop:${current.propId}`;
  };

  const setActiveTab = (axis: AxisSlot) => {
    activeAxis = axis;
    Array.from(axisTabs.children).forEach((child) => child.classList.remove('active'));
    const tab = axisTabs.querySelector(`[data-axis="${axis}"]`);
    if (tab) tab.classList.add('active');
    updateSelectValue();
  };

  (['x', 'y', 'z'] as AxisSlot[]).forEach((axis) => {
    const tab = el('button', {
      className: axis === activeAxis ? 'sw-axis-tab active' : 'sw-axis-tab',
      text: `${axis.toUpperCase()} Axis`,
      attrs: { 'data-axis': axis },
    });
    tab.addEventListener('click', () => setActiveTab(axis));
    axisTabs.appendChild(tab);
  });

  legend.append(
    el('span', { className: 'sw-graph-legend-dot' }),
    el('span', { text: 'Ending Encounter' })
  );

  openButton.addEventListener('click', () => {
    openManifoldWindow();
    sendStoryworldToManifold(store.getState().storyworld);
  });

  toolbar.append(openButton, axisTabs, axisSelectWrap, presetWrap, axisReadout, legend);

  const canvasWrap = el('div', { className: 'sw-graph-canvas' });
  container.append(toolbar, canvasWrap);

  const parseAxis = (value: string): AxisKey => {
    if (value.startsWith('prop:')) {
      return { propId: value.slice(5) };
    }
    return value as AxisKey;
  };

  let fallbackRendered = false;
  const renderFallback2d = () => {
    if (fallbackRendered) return container;
    fallbackRendered = true;
    const message = el('div', {
      className: 'sw-graph-fallback',
      text: 'WebGL unavailable. Showing 2D preview instead.',
    });
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = canvasWrap.clientWidth || 800;
    fallbackCanvas.height = canvasWrap.clientHeight || 600;
    fallbackCanvas.className = 'sw-graph-fallback-canvas';
    canvasWrap.append(message, fallbackCanvas);

    const ctx = fallbackCanvas.getContext('2d');
    const draw2d = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);
      ctx.fillStyle = '#0a0e1b';
      ctx.fillRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);

      const encounters = storyworld.encounters;
      const values = encounters.map((_, index) => ({
        x: axisValue(axisState.x, index, store),
        y: axisValue(axisState.y, index, store),
        z: axisValue(axisState.z, index, store),
        encounter: encounters[index],
      }));
      const max = values.reduce(
        (acc, v) => ({
          x: Math.max(acc.x, Math.abs(v.x)),
          y: Math.max(acc.y, Math.abs(v.y)),
          z: Math.max(acc.z, Math.abs(v.z)),
        }),
        { x: 1, y: 1, z: 1 }
      );
      const padding = 30;
      const width = fallbackCanvas.width - padding * 2;
      const height = fallbackCanvas.height - padding * 2;

      ctx.strokeStyle = '#303a55';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(padding, padding, width, height);
      ctx.stroke();

      values.forEach((v) => {
        const isEnding = v.encounter.options.length === 0;
        const px = padding + ((v.x / max.x) * 0.5 + 0.5) * width;
        const py = padding + (1 - ((v.y / max.y) * 0.5 + 0.5)) * height;
        ctx.beginPath();
        ctx.fillStyle = isEnding ? '#ffc86b' : '#e8ecff';
        ctx.strokeStyle = isEnding ? '#ffb347' : '#6a86ff';
        ctx.lineWidth = 1;
        ctx.arc(px, py, isEnding ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    };

    updateReadout();
    updateSelectValue();
    draw2d();
    axisSelect.select.addEventListener('change', () => {
      axisState = { ...axisState, [activeAxis]: parseAxis(axisSelect.select.value) };
      updateReadout();
      draw2d();
    });
    presetSelect.addEventListener('change', () => {
      const preset = presets[Number(presetSelect.value)];
      if (!preset) return;
      axisState = { ...preset.axes };
      updateReadout();
      updateSelectValue();
      draw2d();
    });
    window.addEventListener('resize', () => {
      fallbackCanvas.width = canvasWrap.clientWidth || 800;
      fallbackCanvas.height = canvasWrap.clientHeight || 600;
      draw2d();
    });

    return container;
  };

  const isWebGLAvailable = () => {
    try {
      const testCanvas = document.createElement('canvas');
      return !!(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'));
    } catch {
      return false;
    }
  };

  if (!isWebGLAvailable()) {
    return renderFallback2d();
  }

  let scene: THREE.Scene | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let pointsGroup: THREE.Group | null = null;
  let endingsGroup: THREE.Group | null = null;
  let labelLayer: HTMLDivElement | null = null;
  let labels: { mesh: THREE.Object3D; el: HTMLDivElement }[] = [];
  let animationFrame = 0;
  let resizeObserver: ResizeObserver | null = null;
  let t = 0;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tooltip = el('div', { className: 'sw-graph-tooltip' });
  tooltip.style.display = 'none';
  const leaveHandler = () => {
    tooltip.style.display = 'none';
  };

  const buildPoints = () => {
    if (!pointsGroup || !endingsGroup || !labelLayer) return;
    pointsGroup.clear();
    endingsGroup.clear();
    labelLayer.innerHTML = '';
    labels = [];
    const encounters = storyworld.encounters;
    const values = encounters.map((_, index) => ({
      x: axisValue(axisState.x, index, store),
      y: axisValue(axisState.y, index, store),
      z: axisValue(axisState.z, index, store),
      encounter: encounters[index],
    }));
    const max = values.reduce(
      (acc, v) => ({
        x: Math.max(acc.x, Math.abs(v.x)),
        y: Math.max(acc.y, Math.abs(v.y)),
        z: Math.max(acc.z, Math.abs(v.z)),
      }),
      { x: 1, y: 1, z: 1 }
    );
    const scale = 6;
    values.forEach((v) => {
      const isEnding = v.encounter.options.length === 0;
      const geometry = new THREE.SphereGeometry(isEnding ? 0.18 : 0.12, 18, 18);
      const material = new THREE.MeshStandardMaterial({
        color: isEnding ? 0xffc86b : 0xe8ecff,
        emissive: isEnding ? 0xffc86b : 0x6a86ff,
        emissiveIntensity: isEnding ? 1.2 : 0.5,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        (v.x / max.x) * scale,
        (v.y / max.y) * scale,
        (v.z / max.z) * scale
      );
      mesh.userData = { encounter: v.encounter };
      if (isEnding) {
        endingsGroup.add(mesh);
      } else {
        pointsGroup.add(mesh);
      }

      const label = el('div', {
        className: `sw-graph-label${isEnding ? ' ending' : ''}`,
        text: v.encounter.title || v.encounter.id || 'Encounter',
      }) as HTMLDivElement;
      labelLayer.appendChild(label);
      labels.push({ mesh, el: label });
    });
  };

  const updateAxes = () => {
    buildPoints();
  };

  const updateLabels = () => {
    if (!renderer || !camera) return;
    labels.forEach(({ mesh, el: label }) => {
      const pos = mesh.position.clone();
      pos.project(camera);
      if (pos.z < -1 || pos.z > 1) {
        label.style.display = 'none';
        return;
      }
      const x = (pos.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
      const y = (-pos.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
      if (x < 0 || y < 0 || x > renderer.domElement.clientWidth || y > renderer.domElement.clientHeight) {
        label.style.display = 'none';
        return;
      }
      label.style.display = 'block';
      label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    });
  };

  const handleHover = (event: MouseEvent) => {
    if (!renderer || !camera || !pointsGroup || !endingsGroup) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(
      [...pointsGroup.children, ...endingsGroup.children],
      false
    );
    if (hits.length) {
      const hit = hits[0].object as THREE.Mesh;
      const encounter = hit.userData.encounter as { title?: string; id?: string } | undefined;
      const label = encounter?.title || encounter?.id || 'Untitled Encounter';
      tooltip.textContent = label;
      tooltip.style.display = 'block';
      tooltip.style.left = `${event.clientX - rect.left + 12}px`;
      tooltip.style.top = `${event.clientY - rect.top + 12}px`;
    } else {
      tooltip.style.display = 'none';
    }
  };

  const handleClick = (event: MouseEvent) => {
    if (!renderer || !camera || !pointsGroup || !endingsGroup) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(
      [...pointsGroup.children, ...endingsGroup.children],
      false
    );
    if (hits.length) {
      const hit = hits[0].object as THREE.Mesh;
      const encounter = hit.userData.encounter as { id?: string } | undefined;
      if (encounter?.id) {
        store.setState({
          selections: {
            ...store.getState().selections,
            encounterId: encounter.id,
            optionId: null,
            reactionId: null,
          },
        });
      }
    }
  };

  const resize = () => {
    if (!renderer || !camera) return;
    const width = canvasWrap.clientWidth || 800;
    const height = canvasWrap.clientHeight || 600;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updateLabels();
  };

  const disposeScene = () => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (renderer) {
      renderer.domElement.removeEventListener('mousemove', handleHover);
      renderer.domElement.removeEventListener('mouseleave', leaveHandler);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    }
    if (controls) controls.dispose();
    if (scene) {
      scene.traverse((child) => {
        if ((child as THREE.Mesh).geometry) {
          (child as THREE.Mesh).geometry.dispose();
        }
        const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (material) {
          if (Array.isArray(material)) {
            material.forEach((mat) => mat.dispose());
          } else {
            material.dispose();
          }
        }
      });
    }
    if (resizeObserver) resizeObserver.disconnect();
    if (labelLayer && labelLayer.parentElement) {
      labelLayer.parentElement.removeChild(labelLayer);
    }
    if (tooltip.parentElement) tooltip.parentElement.removeChild(tooltip);
    renderer = null;
    controls = null;
    scene = null;
    camera = null;
    pointsGroup = null;
    endingsGroup = null;
    labelLayer = null;
    labels = [];
  };

  const initWebGL = () => {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05060a, 0.03);
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      return false;
    }
    if (!renderer) return false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvasWrap.clientWidth || 800, canvasWrap.clientHeight || 600);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasWrap.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    camera.position.set(0, 12, 20);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0x9aa7ff, 0.3));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(8, 12, 6);
    scene.add(key);

    const axes = new THREE.AxesHelper(8);
    (axes.material as THREE.Material).opacity = 0.6;
    (axes.material as THREE.Material).transparent = true;
    scene.add(axes);

    pointsGroup = new THREE.Group();
    scene.add(pointsGroup);
    endingsGroup = new THREE.Group();
    scene.add(endingsGroup);

    labelLayer = el('div', { className: 'sw-graph-label-layer' });
    canvasWrap.appendChild(labelLayer);

    canvasWrap.appendChild(tooltip);
    renderer.domElement.addEventListener('mousemove', handleHover);
    renderer.domElement.addEventListener('mouseleave', leaveHandler);
    renderer.domElement.addEventListener('click', handleClick);

    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      disposeScene();
      renderFallback2d();
    });

    renderer.domElement.addEventListener('webglcontextrestored', () => {
      disposeScene();
      requestAnimationFrame(() => initWebGL());
    });

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvasWrap);
    resize();
    return true;
  };

  const startAnimation = () => {
    if (!renderer || !scene || !camera || !controls || !endingsGroup) return;
    const animate = () => {
      t += 0.01;
      endingsGroup.children.forEach((child, index) => {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.7 + Math.sin(t + index) * 0.3;
      });
      updateLabels();
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();
  };

  axisSelect.select.addEventListener('change', () => {
    axisState = { ...axisState, [activeAxis]: parseAxis(axisSelect.select.value) };
    updateReadout();
    updateAxes();
  });

  presetSelect.addEventListener('change', () => {
    const preset = presets[Number(presetSelect.value)];
    if (!preset) return;
    axisState = { ...preset.axes };
    updateReadout();
    updateAxes();
    updateSelectValue();
  });

  updateReadout();
  updateSelectValue();

  requestAnimationFrame(() => {
    const ok = initWebGL();
    if (!ok) {
      renderFallback2d();
      return;
    }
    buildPoints();
    startAnimation();
  });

  return container;
}
