const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

/**
 * Normalizes unit to feet for internal geometric calculations while preserving
 * the user's display unit ('feet' or 'meters').
 */
function toFeet(val, unit) {
  const num = Number(val) || 0;
  return unit === 'meters' ? +(num * 3.28084).toFixed(2) : +num.toFixed(2);
}

/**
 * Escapes XML special characters for safe SVG rendering.
 */
function escXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validates and builds a single canonical, deterministic, geometry-validated
 * residential layout model from the user's request payload.
 */
function buildCanonicalLayout(jsonData) {
  if (!jsonData || typeof jsonData !== 'object') {
    const err = new Error('Missing or invalid house plan specification payload (jsonData).');
    err.status = 400;
    throw err;
  }

  const plotIn = jsonData.plot || {};
  const reqIn = jsonData.requirements || {};
  const familyIn = jsonData.family || {};
  const vastuIn = jsonData.vastu || {};
  const styleIn = jsonData.style || {};
  const contextIn = jsonData.site_context || {};
  const notesIn = jsonData.additional_notes || {};

  const displayUnit = plotIn.unit === 'meters' ? 'meters' : 'feet';
  const rawWidth = Number(plotIn.width);
  const rawDepth = Number(plotIn.depth);

  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawDepth) || rawWidth <= 0 || rawDepth <= 0) {
    const err = new Error('Plot width and depth must be positive numbers.');
    err.status = 400;
    throw err;
  }

  const plotWidthFt = toFeet(rawWidth, displayUnit);
  const plotDepthFt = toFeet(rawDepth, displayUnit);

  if (plotWidthFt < 15 || plotDepthFt < 18) {
    const err = new Error(
      `Plot dimensions (${rawWidth} × ${rawDepth} ${displayUnit}) are below the minimum residential buildable footprint (15 ft × 18 ft).`
    );
    err.status = 400;
    throw err;
  }

  if (plotWidthFt > 300 || plotDepthFt > 300) {
    const err = new Error(
      `Plot dimensions (${rawWidth} × ${rawDepth} ${displayUnit}) exceed single-parcel residential layout bounds (300 ft × 300 ft).`
    );
    err.status = 400;
    throw err;
  }

  const stories = Math.max(1, Math.min(4, Number(reqIn.stories) || 1));
  const roomsReq = Array.isArray(reqIn.rooms) ? reqIn.rooms : [];

  const bedroomEntry = roomsReq.find((r) => r.type === 'bedroom') || { quantity: 2 };
  const bedrooms = Math.max(1, Math.min(12, Number(bedroomEntry.quantity) || 2));
  const masterFeatures = bedroomEntry.master_features || {};

  const bathEntry = roomsReq.find((r) => r.type === 'bathroom') || { preference: 'attached', quantity: bedrooms };
  const bathPref = bathEntry.preference || 'attached';
  const bathrooms = Math.max(1, Math.min(12, Number(bathEntry.quantity) || bedrooms));

  const hasLiving = roomsReq.some((r) => r.type === 'living_room') !== false;
  const diningEntry = roomsReq.find((r) => r.type === 'dining');
  const diningStyle = diningEntry ? diningEntry.style || 'separate' : 'none';
  const kitchenEntry = roomsReq.find((r) => r.type === 'kitchen') || { kitchen_type: 'closed', features: [] };
  const kitchenType = kitchenEntry.kitchen_type || 'closed';
  const hasPooja = roomsReq.some((r) => r.type === 'pooja_room');
  const hasStudy = roomsReq.some((r) => r.type === 'study') || Boolean(masterFeatures.study_corner);
  const hasStore = roomsReq.some((r) => r.type === 'store_room');
  const balconyEntry = roomsReq.find((r) => r.type === 'balcony');
  const balconies = balconyEntry ? Number(balconyEntry.quantity) || 0 : 0;
  const parkingEntry = roomsReq.find((r) => r.type === 'parking');
  const hasParking = Boolean(parkingEntry) && (Number(parkingEntry.cars) || 0) > 0;
  const parkingCars = hasParking ? Math.max(1, Number(parkingEntry.cars) || 1) : 0;
  const parkingType = parkingEntry ? parkingEntry.parking_type || 'covered' : 'none';

  // Explicit or default setbacks (in feet)
  const explicitSetbacks = plotIn.setbacks && typeof plotIn.setbacks === 'object' ? plotIn.setbacks : null;
  const neighborWalls = Array.isArray(contextIn.neighboring_walls) ? contextIn.neighboring_walls : [];

  let frontSetbackFt;
  let rearSetbackFt;
  let leftSetbackFt;
  let rightSetbackFt;
  let setbackSource;

  if (explicitSetbacks) {
    frontSetbackFt = Math.max(0, toFeet(explicitSetbacks.front ?? 3, displayUnit));
    rearSetbackFt = Math.max(0, toFeet(explicitSetbacks.rear ?? explicitSetbacks.back ?? 2, displayUnit));
    leftSetbackFt = Math.max(0, toFeet(explicitSetbacks.left ?? 2, displayUnit));
    rightSetbackFt = Math.max(0, toFeet(explicitSetbacks.right ?? 2, displayUnit));
    setbackSource = 'User-Supplied Setbacks';
  } else {
    frontSetbackFt = plotDepthFt >= 35 ? 3.0 : 2.0;
    rearSetbackFt = plotDepthFt >= 35 ? 2.0 : 1.5;
    leftSetbackFt = plotWidthFt >= 28 ? 2.0 : 1.5;
    rightSetbackFt = plotWidthFt >= 28 ? 2.0 : 1.5;
    setbackSource = 'Default Conceptual Setbacks (Assumed — Not User-Supplied)';
  }

  const envelopeWidthFt = +(plotWidthFt - leftSetbackFt - rightSetbackFt).toFixed(2);
  const envelopeDepthFt = +(plotDepthFt - frontSetbackFt - rearSetbackFt).toFixed(2);

  if (envelopeWidthFt < 12 || envelopeDepthFt < 14) {
    const err = new Error(
      `After applying peripheral setbacks (Front ${frontSetbackFt}ft, Rear ${rearSetbackFt}ft, Left ${leftSetbackFt}ft, Right ${rightSetbackFt}ft), the buildable envelope (${envelopeWidthFt}ft × ${envelopeDepthFt}ft) is too narrow for habitable rooms.`
    );
    err.status = 400;
    throw err;
  }

  const plotAreaSqFt = Math.round(plotWidthFt * plotDepthFt);
  const envelopeAreaSqFt = Math.round(envelopeWidthFt * envelopeDepthFt);
  const totalAvailableFloorPlateSqFt = envelopeAreaSqFt * stories;

  // Feasibility check: minimum required area per requested program
  const minRequiredAreaSqFt =
    bedrooms * 110 +
    bathrooms * 32 +
    (hasLiving ? 130 : 0) +
    1 + // kitchen
    65 +
    (diningStyle !== 'none' && diningStyle !== 'in_kitchen' ? 75 : 0) +
    (hasParking ? 110 : 0) +
    (hasStudy ? 55 : 0) +
    (hasPooja ? 20 : 0) +
    (hasStore ? 24 : 0);

  if (minRequiredAreaSqFt > totalAvailableFloorPlateSqFt * 0.96) {
    const err = new Error(
      `Infeasible spatial program: Requesting ${bedrooms} bedroom(s), ${bathrooms} bathroom(s)${
        hasParking ? `, ${parkingCars}-car parking` : ''
      } and ancillary spaces requires at least ${minRequiredAreaSqFt} sq.ft, which exceeds the ${totalAvailableFloorPlateSqFt} sq.ft setback-constrained buildable envelope across ${stories} floor(s) on a ${rawWidth} × ${rawDepth} ${displayUnit} plot. Increase plot dimensions, add a storey, or reduce room count.`
    );
    err.status = 400;
    throw err;
  }

  // Deterministic subdivision of the Ground Floor buildable envelope:
  // Coordinate system:
  // Origin (0,0) = Top-Left (North-West / Rear-Left) of Plot
  // X increases Left -> Right (0 to plotWidthFt)
  // Y increases Rear (Top, Y=0) -> Front Road (Bottom, Y=plotDepthFt)
  // Buildable Envelope spans X: [ex0, ex0 + ew], Y: [ey0, ey0 + ed]
  const ex0 = leftSetbackFt;
  const ey0 = rearSetbackFt;
  const ew = envelopeWidthFt;
  const ed = envelopeDepthFt;

  // Partition envelope into 3 horizontal depth bands from Rear (top) to Front Road (bottom):
  // Band 1 (Rear Private Zone): Master Bedroom + Bedroom 2 / Study + Ensuite Bath(s)
  // Band 2 (Central Core Zone): Dining / Circulation Spine + Kitchen + Common Bath / Utility / Pooja / Stair
  // Band 3 (Front Public & Ingress Zone): Living Lounge + Entrance Foyer / Verandah + Car Parking Bay (if enabled)
  const rearDepth = +(ed * 0.38).toFixed(1);
  const midDepth = +(ed * 0.28).toFixed(1);
  const frontDepth = +(ed - rearDepth - midDepth).toFixed(1);

  const yRear = ey0;
  const yMid = +(ey0 + rearDepth).toFixed(1);
  const yFront = +(ey0 + rearDepth + midDepth).toFixed(1);

  const groundFloorBedrooms = stories === 1 ? bedrooms : Math.max(1, Math.ceil(bedrooms / stories));
  const rooms = [];

  // --- BAND 1: REAR PRIVATE ZONE ---
  const masterW = +(ew * 0.54).toFixed(1);
  const rightRearW = +(ew - masterW).toFixed(1);

  // Master Bedroom (Rear-Left / SW Vastu)
  const mbBathH = masterFeatures.attached_bathroom !== false ? +(Math.min(6.0, Math.max(4.5, rearDepth * 0.34))).toFixed(1) : 0;
  const mbMainH = +(rearDepth - mbBathH).toFixed(1);

  rooms.push({
    id: 'master_bedroom',
    code: 'R-01',
    name: 'Master Bedroom',
    category: 'private',
    floor: 1,
    x: ex0,
    y: yRear,
    width: masterW,
    depth: mbMainH,
    areaSqFt: Math.round(masterW * mbMainH),
    zone: 'Rear-West (SW Quadrant)',
    doors: [{ wall: 'south', offsetRatio: 0.78, widthFt: 3.0, swing: 'in-left', connectsTo: 'Dining & Central Hall' }],
    windows: [
      { wall: 'north', offsetRatio: 0.5, widthFt: 4.5 },
      ...(!neighborWalls.includes('west') ? [{ wall: 'west', offsetRatio: 0.5, widthFt: 4.0 }] : []),
    ],
    furniture: 'bed_double',
  });

  if (mbBathH > 0) {
    const bathW = +(masterW * 0.58).toFixed(1);
    const dressW = +(masterW - bathW).toFixed(1);
    rooms.push({
      id: 'master_bath',
      code: 'R-02',
      name: 'Attached Bath 1',
      category: 'wet',
      floor: 1,
      x: ex0,
      y: +(yRear + mbMainH).toFixed(1),
      width: bathW,
      depth: mbBathH,
      areaSqFt: Math.round(bathW * mbBathH),
      zone: 'West Wet Core',
      doors: [{ wall: 'north', offsetRatio: 0.65, widthFt: 2.5, swing: 'in-left', connectsTo: 'Master Bedroom' }],
      windows: [{ wall: 'west', offsetRatio: 0.5, widthFt: 2.0 }],
      furniture: 'bath_fixtures',
    });

    rooms.push({
      id: 'wardrobe_alcove',
      code: 'R-03',
      name: masterFeatures.walk_in_wardrobe ? 'Walk-In Wardrobe' : hasStore ? 'Store / Dress' : 'Dressing Alcove',
      category: 'service',
      floor: 1,
      x: +(ex0 + bathW).toFixed(1),
      y: +(yRear + mbMainH).toFixed(1),
      width: dressW,
      depth: mbBathH,
      areaSqFt: Math.round(dressW * mbBathH),
      zone: 'Interior Service Core',
      doors: [{ wall: 'north', offsetRatio: 0.5, widthFt: 2.5, swing: 'in-right', connectsTo: 'Master Bedroom' }],
      windows: [],
      furniture: 'wardrobe',
    });
  }

  // Rear-Right: Bedroom 2 (or Study/Guest Suite if 1BHK)
  const bed2BathH = bathrooms >= 2 ? +(Math.min(5.5, Math.max(4.5, rearDepth * 0.32))).toFixed(1) : 0;
  const bed2MainH = +(rearDepth - bed2BathH).toFixed(1);

  rooms.push({
    id: 'bedroom_2',
    code: 'R-04',
    name: groundFloorBedrooms >= 2 ? 'Bedroom 2' : hasStudy ? 'Study / Home Office' : 'Guest Suite',
    category: 'private',
    floor: 1,
    x: +(ex0 + masterW).toFixed(1),
    y: yRear,
    width: rightRearW,
    depth: bed2MainH,
    areaSqFt: Math.round(rightRearW * bed2MainH),
    zone: 'Rear-East (NE/NW Quadrant)',
    doors: [{ wall: 'south', offsetRatio: 0.25, widthFt: 3.0, swing: 'in-right', connectsTo: 'Dining & Central Hall' }],
    windows: [
      { wall: 'north', offsetRatio: 0.5, widthFt: 4.0 },
      ...(!neighborWalls.includes('east') ? [{ wall: 'east', offsetRatio: 0.5, widthFt: 3.5 }] : []),
    ],
    furniture: 'bed_twin',
  });

  if (bed2BathH > 0) {
    rooms.push({
      id: 'common_bath',
      code: 'R-05',
      name: bathPref === 'attached' ? 'Attached Bath 2' : 'Common Bathroom',
      category: 'wet',
      floor: 1,
      x: +(ex0 + masterW).toFixed(1),
      y: +(yRear + bed2MainH).toFixed(1),
      width: rightRearW,
      depth: bed2BathH,
      areaSqFt: Math.round(rightRearW * bed2BathH),
      zone: 'East Wet Stack',
      doors: [
        {
          wall: bathPref === 'attached' ? 'north' : 'south',
          offsetRatio: 0.4,
          widthFt: 2.5,
          swing: 'in-right',
          connectsTo: bathPref === 'attached' ? 'Bedroom 2' : 'Dining & Central Hall',
        },
      ],
      windows: [{ wall: 'east', offsetRatio: 0.5, widthFt: 2.0 }],
      furniture: 'bath_fixtures',
    });
  }

  // --- BAND 2: CENTRAL CORE ZONE (Dining + Pooja/Stair + Kitchen) ---
  const kitchenW = +(ew * 0.42).toFixed(1);
  const diningW = +(ew - kitchenW).toFixed(1);

  rooms.push({
    id: 'dining_hall',
    code: 'R-06',
    name: diningStyle === 'none' ? 'Central Circulation Hall' : `Dining Hall (${diningEntry?.capacity || '6'}-Seater)`,
    category: 'public',
    floor: 1,
    x: ex0,
    y: yMid,
    width: diningW,
    depth: midDepth,
    areaSqFt: Math.round(diningW * midDepth),
    zone: 'Central Brahmasthan Spine',
    doors: [],
    windows: !neighborWalls.includes('west') ? [{ wall: 'west', offsetRatio: 0.5, widthFt: 3.5 }] : [],
    furniture: 'dining_table',
  });

  // Kitchen on Mid-Right (SE/East Zone)
  const poojaOrUtilityH = hasPooja || stories >= 2 ? +(Math.min(4.8, midDepth * 0.34)).toFixed(1) : 0;
  const kitchenMainH = +(midDepth - poojaOrUtilityH).toFixed(1);

  if (poojaOrUtilityH > 0) {
    rooms.push({
      id: 'pooja_or_stair',
      code: 'R-07',
      name: stories >= 2 ? 'Staircase Core' : 'Pooja Chamber',
      category: 'circulation',
      floor: 1,
      x: +(ex0 + diningW).toFixed(1),
      y: yMid,
      width: kitchenW,
      depth: poojaOrUtilityH,
      areaSqFt: Math.round(kitchenW * poojaOrUtilityH),
      zone: 'East Core',
      doors: [{ wall: 'west', offsetRatio: 0.5, widthFt: 2.8, swing: 'open', connectsTo: 'Dining Hall' }],
      windows: [],
      furniture: stories >= 2 ? 'stairs' : 'pooja',
    });
  }

  rooms.push({
    id: 'kitchen',
    code: 'R-08',
    name: `Kitchen (${kitchenType.charAt(0).toUpperCase() + kitchenType.slice(1)})`,
    category: 'wet',
    floor: 1,
    x: +(ex0 + diningW).toFixed(1),
    y: +(yMid + poojaOrUtilityH).toFixed(1),
    width: kitchenW,
    depth: kitchenMainH,
    areaSqFt: Math.round(kitchenW * kitchenMainH),
    zone: 'South-East Culinary Zone',
    doors: [
      {
        wall: 'west',
        offsetRatio: 0.5,
        widthFt: kitchenType === 'open' ? 5.0 : 3.0,
        swing: kitchenType === 'open' ? 'open' : 'in-left',
        connectsTo: 'Dining Hall',
      },
    ],
    windows: [{ wall: 'east', offsetRatio: 0.55, widthFt: 3.5 }],
    furniture: 'kitchen_counter',
  });

  // --- BAND 3: FRONT PUBLIC & INGRESS ZONE (Living Room + Foyer + Car Parking) ---
  if (hasParking) {
    const parkingW = +(Math.min(ew * 0.42, Math.max(9.0, ew * 0.38))).toFixed(1);
    const livingW = +(ew - parkingW).toFixed(1);
    const foyerH = +(Math.min(4.5, frontDepth * 0.28)).toFixed(1);
    const mainLivingH = +(frontDepth - foyerH).toFixed(1);

    rooms.push({
      id: 'living_room',
      code: 'R-09',
      name: 'Formal Living Lounge',
      category: 'public',
      floor: 1,
      x: ex0,
      y: yFront,
      width: livingW,
      depth: mainLivingH,
      areaSqFt: Math.round(livingW * mainLivingH),
      zone: 'Front-West Reception',
      doors: [{ wall: 'south', offsetRatio: 0.72, widthFt: 3.5, swing: 'in-left', connectsTo: 'Entrance Sit-Out / Foyer' }],
      windows: [
        { wall: 'south', offsetRatio: 0.3, widthFt: 4.5 },
        ...(!neighborWalls.includes('west') ? [{ wall: 'west', offsetRatio: 0.5, widthFt: 4.0 }] : []),
      ],
      furniture: 'living_sofa',
    });

    rooms.push({
      id: 'entrance_foyer',
      code: 'R-10',
      name: 'Entrance Verandah / Foyer',
      category: 'circulation',
      floor: 1,
      x: ex0,
      y: +(yFront + mainLivingH).toFixed(1),
      width: livingW,
      depth: foyerH,
      areaSqFt: Math.round(livingW * foyerH),
      zone: `Front Ingress (${(plotIn.facing || 'north').toUpperCase()} Road)`,
      doors: [],
      windows: [],
      furniture: 'foyer',
      isSemiOpen: true,
    });

    rooms.push({
      id: 'car_parking',
      code: 'R-11',
      name: `${parkingType === 'garage' ? 'Enclosed Garage' : 'Covered Portico'} (${parkingCars} Car)`,
      category: 'parking',
      floor: 1,
      x: +(ex0 + livingW).toFixed(1),
      y: yFront,
      width: parkingW,
      depth: frontDepth,
      areaSqFt: Math.round(parkingW * frontDepth),
      zone: 'Front-East Vehicular Bay',
      doors: [{ wall: 'west', offsetRatio: 0.35, widthFt: 3.0, swing: 'in-left', connectsTo: 'Formal Living Lounge' }],
      windows: [],
      furniture: 'car_bay',
      isSemiOpen: parkingType !== 'garage',
    });
  } else {
    const foyerW = +(ew * 0.32).toFixed(1);
    const livingW = +(ew - foyerW).toFixed(1);

    rooms.push({
      id: 'living_room',
      code: 'R-09',
      name: 'Formal Living Lounge',
      category: 'public',
      floor: 1,
      x: ex0,
      y: yFront,
      width: livingW,
      depth: frontDepth,
      areaSqFt: Math.round(livingW * frontDepth),
      zone: 'Front Reception',
      doors: [{ wall: 'east', offsetRatio: 0.65, widthFt: 3.5, swing: 'in-left', connectsTo: 'Entrance Foyer' }],
      windows: [{ wall: 'south', offsetRatio: 0.45, widthFt: 5.0 }],
      furniture: 'living_sofa',
    });

    rooms.push({
      id: 'entrance_foyer',
      code: 'R-10',
      name: hasStudy && groundFloorBedrooms >= 2 ? 'Front Study & Foyer' : 'Entrance Foyer & Verandah',
      category: 'circulation',
      floor: 1,
      x: +(ex0 + livingW).toFixed(1),
      y: yFront,
      width: foyerW,
      depth: frontDepth,
      areaSqFt: Math.round(foyerW * frontDepth),
      zone: `Front Ingress (${(plotIn.facing || 'north').toUpperCase()} Road)`,
      doors: [{ wall: 'south', offsetRatio: 0.5, widthFt: 3.5, swing: 'in-left', connectsTo: 'Front Road Access' }],
      windows: [{ wall: 'east', offsetRatio: 0.5, widthFt: 3.5 }],
      furniture: 'foyer',
    });
  }

  // Compute exact built-up areas from placed rooms
  const groundFloorEnclosedSqFt = rooms
    .filter((r) => !r.isSemiOpen)
    .reduce((acc, r) => acc + r.areaSqFt, 0);
  const groundFloorSemiOpenSqFt = rooms
    .filter((r) => r.isSemiOpen)
    .reduce((acc, r) => acc + r.areaSqFt, 0);
  const groundFloorGrossFootprintSqFt = groundFloorEnclosedSqFt + groundFloorSemiOpenSqFt;
  const upperFloorsBuiltUpSqFt = stories > 1 ? (stories - 1) * groundFloorEnclosedSqFt : 0;
  const totalBuiltUpAreaSqFt = groundFloorGrossFootprintSqFt + upperFloorsBuiltUpSqFt;
  const openSetbackAreaSqFt = Math.max(0, plotAreaSqFt - groundFloorGrossFootprintSqFt);
  const groundCoveragePct = +((groundFloorGrossFootprintSqFt / plotAreaSqFt) * 100).toFixed(1);

  return {
    plot: {
      rawWidth,
      rawDepth,
      displayUnit,
      widthFt: plotWidthFt,
      depthFt: plotDepthFt,
      areaSqFt: plotAreaSqFt,
      shape: plotIn.shape || 'rectangular',
      facing: (plotIn.facing || 'north').toLowerCase(),
      roadWidth: Number(plotIn.road_width_front) || 20,
      roadAccess: Array.isArray(plotIn.road_access) ? plotIn.road_access : ['front'],
    },
    setbacks: {
      frontFt: frontSetbackFt,
      rearFt: rearSetbackFt,
      leftFt: leftSetbackFt,
      rightFt: rightSetbackFt,
      source: setbackSource,
      isExplicit: Boolean(explicitSetbacks),
    },
    envelope: {
      x: ex0,
      y: ey0,
      widthFt: envelopeWidthFt,
      depthFt: envelopeDepthFt,
      areaSqFt: envelopeAreaSqFt,
    },
    areas: {
      plotAreaSqFt,
      setbackOpenAreaSqFt: openSetbackAreaSqFt,
      buildingEnvelopeSqFt: envelopeAreaSqFt,
      groundFloorEnclosedSqFt,
      groundFloorSemiOpenSqFt,
      groundFloorFootprintSqFt: groundFloorGrossFootprintSqFt,
      upperFloorsBuiltUpSqFt,
      totalBuiltUpAreaSqFt,
      groundCoveragePct,
      stories,
    },
    program: {
      stories,
      bedrooms,
      bathrooms,
      bathPref,
      kitchenType,
      diningStyle,
      hasParking,
      parkingCars,
      parkingType,
      hasPooja,
      hasStudy,
      hasStore,
      balconies,
      vastuEnabled: Boolean(vastuIn.enabled),
      vastuStrictness: vastuIn.strictness || 'balanced',
      archStyle: styleIn.type || 'contemporary',
      finish: styleIn.finish || 'standard',
      specialNotes: notesIn.special_requirements || '',
      avoidNotes: notesIn.things_to_avoid || '',
      adults: Number(familyIn.adults) || 2,
      children: Number(familyIn.children) || 0,
      elders: Number(familyIn.elders) || 0,
    },
    rooms,
  };
}

/**
 * Generates a high-precision 2D Orthographic CAD Floor Plan SVG from the
 * canonical layout model.
 */
function render2DFloorPlanSvg(model) {
  const { plot, setbacks, envelope, areas, rooms, program } = model;
  const svgW = 1000;
  const svgH = 1180;

  // Drawing viewport box inside SVG
  const padX = 105;
  const padTop = 122;
  const availW = svgW - padX * 2;
  const availH = 740;

  const scale = Math.min(availW / plot.widthFt, availH / plot.depthFt);
  const drawPlotW = +(plot.widthFt * scale).toFixed(1);
  const drawPlotH = +(plot.depthFt * scale).toFixed(1);
  const ox = +((svgW - drawPlotW) / 2).toFixed(1);
  const oy = +((padTop + (availH - drawPlotH) / 2)).toFixed(1);

  const px = (ftX) => +(ox + ftX * scale).toFixed(1);
  const py = (ftY) => +(oy + ftY * scale).toFixed(1);
  const len = (ft) => +(ft * scale).toFixed(1);

  const categoryFills = {
    private: 'url(#woodFloorPat)',
    public: 'url(#livingFloorPat)',
    wet: 'url(#wetTilePat)',
    circulation: '#F8FAFC',
    service: '#F1F5F9',
    parking: 'url(#parkingPat)',
  };

  let roomElements = '';

  for (const r of rooms) {
    const rx = px(r.x);
    const ry = py(r.y);
    const rw = len(r.width);
    const rh = len(r.depth);
    const fill = categoryFills[r.category] || '#FFFFFF';
    const cx = +(rx + rw / 2).toFixed(1);
    const cy = +(ry + rh / 2).toFixed(1);

    // Room fill & CAD double-line wall
    roomElements += `
      <g>
        <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}" stroke="#0F172A" stroke-width="${r.isSemiOpen ? '2.5' : '6.5'}" ${r.isSemiOpen ? 'stroke-dasharray="9 5"' : ''}/>
        <rect x="${+(rx + 3.2).toFixed(1)}" y="${+(ry + 3.2).toFixed(1)}" width="${Math.max(2, +(rw - 6.4).toFixed(1))}" height="${Math.max(2, +(rh - 6.4).toFixed(1))}" fill="none" stroke="#1E293B" stroke-opacity="0.65" stroke-width="1.3"/>
    `;

    // Rich architectural top-down furnished interior layout
    if (r.furniture === 'bed_double' && rw > 60 && rh > 60) {
      const bw = Math.min(58, rw * 0.44);
      const bh = Math.min(64, rh * 0.48);
      const bx = +(rx + 18).toFixed(1);
      const by = +(ry + 10).toFixed(1);
      const rugX = +(bx - 6).toFixed(1);
      const rugY = +(by + 14).toFixed(1);
      const rugW = +(bw + 12).toFixed(1);
      const rugH = +(bh - 6).toFixed(1);
      roomElements += `
        <rect x="${rugX}" y="${rugY}" width="${rugW}" height="${rugH}" rx="4" fill="#FDE68A" fill-opacity="0.55" stroke="#D97706" stroke-width="1" stroke-dasharray="3 2"/>
        <rect x="${+(bx - 9).toFixed(1)}" y="${by}" width="7" height="8" rx="1.5" fill="#92400E" stroke="#451A03" stroke-width="1"/>
        <circle cx="${+(bx - 5.5).toFixed(1)}" cy="${+(by + 4).toFixed(1)}" r="2" fill="#FEF08A"/>
        <rect x="${+(bx + bw + 2).toFixed(1)}" y="${by}" width="7" height="8" rx="1.5" fill="#92400E" stroke="#451A03" stroke-width="1"/>
        <circle cx="${+(bx + bw + 5.5).toFixed(1)}" cy="${+(by + 4).toFixed(1)}" r="2" fill="#FEF08A"/>
        <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3.5" fill="#FFFBEB" stroke="#78350F" stroke-width="1.6"/>
        <rect x="${bx}" y="${by}" width="${bw}" height="6.5" fill="#78350F"/>
        <rect x="${+(bx + 4).toFixed(1)}" y="${+(by + 8).toFixed(1)}" width="${+(bw / 2 - 6).toFixed(1)}" height="11" rx="2.5" fill="#FFFFFF" stroke="#92400E" stroke-width="1.1"/>
        <rect x="${+(bx + bw / 2 + 2).toFixed(1)}" y="${+(by + 8).toFixed(1)}" width="${+(bw / 2 - 6).toFixed(1)}" height="11" rx="2.5" fill="#FFFFFF" stroke="#92400E" stroke-width="1.1"/>
        <rect x="${+(bx + 2).toFixed(1)}" y="${+(by + 22).toFixed(1)}" width="${+(bw - 4).toFixed(1)}" height="${+(bh - 24).toFixed(1)}" rx="2.5" fill="#F59E0B" fill-opacity="0.32" stroke="#B45309" stroke-width="1.1"/>
        <line x1="${bx}" y1="${+(by + 25).toFixed(1)}" x2="${+(bx + bw).toFixed(1)}" y2="${+(by + 25).toFixed(1)}" stroke="#B45309" stroke-width="1.2"/>
        <rect x="${+(rx + rw - 16).toFixed(1)}" y="${+(ry + 10).toFixed(1)}" width="10" height="${Math.min(54, +(rh * 0.46).toFixed(1))}" rx="1.5" fill="#D97706" fill-opacity="0.4" stroke="#78350F" stroke-width="1.3"/>
        <line x1="${+(rx + rw - 11).toFixed(1)}" y1="${+(ry + 10).toFixed(1)}" x2="${+(rx + rw - 11).toFixed(1)}" y2="${+(ry + 10 + Math.min(54, +(rh * 0.46).toFixed(1))).toFixed(1)}" stroke="#78350F" stroke-width="0.9"/>
      `;
    } else if (r.furniture === 'bed_twin' && rw > 55 && rh > 55) {
      const bw = Math.min(46, rw * 0.40);
      const bh = Math.min(54, rh * 0.46);
      const bx = +(rx + rw - bw - 12).toFixed(1);
      const by = +(ry + 10).toFixed(1);
      roomElements += `
        <rect x="${+(bx - 4).toFixed(1)}" y="${+(by + 12).toFixed(1)}" width="${+(bw + 8).toFixed(1)}" height="${+(bh - 6).toFixed(1)}" rx="3" fill="#BAE6FD" fill-opacity="0.45" stroke="#0284C7" stroke-width="0.9" stroke-dasharray="3 2"/>
        <rect x="${+(bx - 8).toFixed(1)}" y="${by}" width="6.5" height="7.5" rx="1.5" fill="#92400E" stroke="#451A03" stroke-width="1"/>
        <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="#FFFBEB" stroke="#78350F" stroke-width="1.5"/>
        <rect x="${bx}" y="${by}" width="${bw}" height="5.5" fill="#78350F"/>
        <rect x="${+(bx + 5).toFixed(1)}" y="${+(by + 7.5).toFixed(1)}" width="${+(bw - 10).toFixed(1)}" height="10" rx="2" fill="#FFFFFF" stroke="#92400E" stroke-width="1.1"/>
        <rect x="${+(bx + 2).toFixed(1)}" y="${+(by + 20).toFixed(1)}" width="${+(bw - 4).toFixed(1)}" height="${+(bh - 22).toFixed(1)}" rx="2" fill="#38BDF8" fill-opacity="0.28" stroke="#0284C7" stroke-width="1"/>
        <rect x="${+(rx + 8).toFixed(1)}" y="${+(ry + 10).toFixed(1)}" width="10" height="${Math.min(44, +(rh * 0.40).toFixed(1))}" rx="1.5" fill="#D97706" fill-opacity="0.4" stroke="#78350F" stroke-width="1.2"/>
      `;
    } else if (r.furniture === 'living_sofa' && rw > 65 && rh > 65) {
      const sw = Math.min(76, rw * 0.52);
      const sh = Math.min(22, rh * 0.22);
      const sx = +(rx + 12).toFixed(1);
      const sy = +(ry + 10).toFixed(1);
      const lArmH = Math.min(48, +(rh * 0.42).toFixed(1));
      roomElements += `
        <rect x="${+(sx + 16).toFixed(1)}" y="${+(sy + sh + 3).toFixed(1)}" width="${Math.max(24, +(sw - 16).toFixed(1))}" height="24" rx="3" fill="#FED7AA" fill-opacity="0.55" stroke="#C2410C" stroke-width="0.9" stroke-dasharray="3 2"/>
        <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="3.5" fill="#FDBA74" stroke="#9A3412" stroke-width="1.5"/>
        <rect x="${sx}" y="${sy}" width="${sw}" height="5" rx="1.5" fill="#9A3412"/>
        <rect x="${sx}" y="${sy}" width="18" height="${lArmH}" rx="3.5" fill="#FDBA74" stroke="#9A3412" stroke-width="1.5"/>
        <rect x="${sx}" y="${sy}" width="5" height="${lArmH}" rx="1.5" fill="#9A3412"/>
        <line x1="${+(sx + sw * 0.38).toFixed(1)}" y1="${+(sy + 5).toFixed(1)}" x2="${+(sx + sw * 0.38).toFixed(1)}" y2="${+(sy + sh).toFixed(1)}" stroke="#9A3412" stroke-width="1"/>
        <line x1="${+(sx + sw * 0.68).toFixed(1)}" y1="${+(sy + 5).toFixed(1)}" x2="${+(sx + sw * 0.68).toFixed(1)}" y2="${+(sy + sh).toFixed(1)}" stroke="#9A3412" stroke-width="1"/>
        <rect x="${+(sx + 24).toFixed(1)}" y="${+(sy + sh + 7).toFixed(1)}" width="${Math.max(20, +(sw - 30).toFixed(1))}" height="15" rx="2.5" fill="#FFF7ED" stroke="#9A3412" stroke-width="1.3"/>
        <circle cx="${+(sx + 34).toFixed(1)}" cy="${+(sy + sh + 14.5).toFixed(1)}" r="3.2" fill="#F59E0B" stroke="#78350F" stroke-width="0.8"/>
        <rect x="${+(rx + rw - 14).toFixed(1)}" y="${+(ry + 14).toFixed(1)}" width="7" height="${Math.min(44, +(rh * 0.38).toFixed(1))}" rx="1.5" fill="#334155" stroke="#0F172A" stroke-width="1"/>
        <circle cx="${+(rx + rw - 16).toFixed(1)}" cy="${+(ry + rh - 14).toFixed(1)}" r="6" fill="#22C55E" fill-opacity="0.75" stroke="#15803D" stroke-width="1.2"/>
      `;
    } else if (r.furniture === 'dining_table' && rw > 60 && rh > 55) {
      const tw = Math.min(54, rw * 0.40);
      const th = Math.min(32, rh * 0.34);
      const tx = +(rx + 14).toFixed(1);
      const ty = +(ry + 12).toFixed(1);
      roomElements += `
        <rect x="${+(tx - 5).toFixed(1)}" y="${+(ty - 6).toFixed(1)}" width="${+(tw + 10).toFixed(1)}" height="${+(th + 12).toFixed(1)}" rx="4" fill="#FEF3C7" fill-opacity="0.6" stroke="#D97706" stroke-width="0.8"/>
        <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="4.5" fill="#FDE68A" stroke="#78350F" stroke-width="1.6"/>
        <circle cx="${+(tx + tw / 2).toFixed(1)}" cy="${+(ty + th / 2).toFixed(1)}" r="4" fill="#F59E0B" stroke="#78350F" stroke-width="1"/>
        <rect x="${+(tx + 5).toFixed(1)}" y="${+(ty - 5).toFixed(1)}" width="10" height="4" rx="1.5" fill="#92400E"/>
        <rect x="${+(tx + tw / 2 - 5).toFixed(1)}" y="${+(ty - 5).toFixed(1)}" width="10" height="4" rx="1.5" fill="#92400E"/>
        <rect x="${+(tx + tw - 15).toFixed(1)}" y="${+(ty - 5).toFixed(1)}" width="10" height="4" rx="1.5" fill="#92400E"/>
        <rect x="${+(tx + 5).toFixed(1)}" y="${+(ty + th + 1).toFixed(1)}" width="10" height="4" rx="1.5" fill="#92400E"/>
        <rect x="${+(tx + tw / 2 - 5).toFixed(1)}" y="${+(ty + th + 1).toFixed(1)}" width="10" height="4" rx="1.5" fill="#92400E"/>
        <rect x="${+(tx + tw - 15).toFixed(1)}" y="${+(ty + th + 1).toFixed(1)}" width="10" height="4" rx="1.5" fill="#92400E"/>
      `;
    } else if (r.furniture === 'kitchen_counter' && rw > 50 && rh > 50) {
      const cDepth = Math.min(18, rw * 0.18);
      roomElements += `
        <path d="M ${+(rx + rw - cDepth - 6).toFixed(1)} ${+(ry + 8).toFixed(1)} H ${+(rx + rw - 6).toFixed(1)} V ${+(ry + rh - 8).toFixed(1)} H ${+(rx + 10).toFixed(1)} V ${+(ry + rh - cDepth - 8).toFixed(1)} H ${+(rx + rw - cDepth - 6).toFixed(1)} Z" fill="#E2E8F0" stroke="#334155" stroke-width="1.6"/>
        <rect x="${+(rx + rw - cDepth - 4).toFixed(1)}" y="${+(ry + 16).toFixed(1)}" width="${Math.max(8, +(cDepth - 4).toFixed(1))}" height="10" rx="1.5" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.2"/>
        <rect x="${+(rx + rw - cDepth - 4).toFixed(1)}" y="${+(ry + 28).toFixed(1)}" width="${Math.max(8, +(cDepth - 4).toFixed(1))}" height="10" rx="1.5" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.2"/>
        <rect x="${+(rx + 18).toFixed(1)}" y="${+(ry + rh - cDepth - 6).toFixed(1)}" width="24" height="${Math.max(8, +(cDepth - 4).toFixed(1))}" rx="2" fill="#1E293B" stroke="#0F172A" stroke-width="1"/>
        <circle cx="${+(rx + 24).toFixed(1)}" cy="${+(ry + rh - cDepth / 2 - 8).toFixed(1)}" r="2.6" fill="none" stroke="#F8FAFC" stroke-width="1.1"/>
        <circle cx="${+(rx + 35).toFixed(1)}" cy="${+(ry + rh - cDepth / 2 - 8).toFixed(1)}" r="2.6" fill="none" stroke="#F8FAFC" stroke-width="1.1"/>
        <rect x="${+(rx + 10).toFixed(1)}" y="${+(ry + 8).toFixed(1)}" width="14" height="14" rx="2" fill="#CBD5E1" stroke="#334155" stroke-width="1.4"/>
      `;
    } else if (r.furniture === 'bath_fixtures' && rw > 42 && rh > 36) {
      roomElements += `
        <rect x="${+(rx + 7).toFixed(1)}" y="${+(ry + 7).toFixed(1)}" width="16" height="11" rx="3" fill="#FFFFFF" stroke="#0284C7" stroke-width="1.4"/>
        <circle cx="${+(rx + 15).toFixed(1)}" cy="${+(ry + 12.5).toFixed(1)}" r="2" fill="#38BDF8"/>
        <rect x="${+(rx + rw - 21).toFixed(1)}" y="${+(ry + 6).toFixed(1)}" width="12" height="5" rx="1.5" fill="#FFFFFF" stroke="#0284C7" stroke-width="1.2"/>
        <ellipse cx="${+(rx + rw - 15).toFixed(1)}" cy="${+(ry + 16).toFixed(1)}" rx="5.5" ry="7.5" fill="#FFFFFF" stroke="#0284C7" stroke-width="1.4"/>
        <rect x="${+(rx + rw - 26).toFixed(1)}" y="${+(ry + rh - 22).toFixed(1)}" width="18" height="15" rx="2" fill="#E0F2FE" fill-opacity="0.7" stroke="#0284C7" stroke-width="1.1" stroke-dasharray="3 2"/>
      `;
    } else if (r.furniture === 'wardrobe' && rw > 40 && rh > 30) {
      roomElements += `
        <rect x="${+(rx + 8).toFixed(1)}" y="${+(ry + 7).toFixed(1)}" width="${Math.max(16, +(rw - 16).toFixed(1))}" height="10" fill="#FDE68A" stroke="#78350F" stroke-width="1.3"/>
      `;
    } else if (r.furniture === 'stairs' && rw > 45 && rh > 30) {
      const sW = Math.min(58, rw * 0.48);
      const sH = Math.min(22, rh * 0.44);
      const sx = +(rx + rw - sW - 10).toFixed(1);
      const sy = +(ry + 8).toFixed(1);
      roomElements += `
        <rect x="${sx}" y="${sy}" width="${sW}" height="${sH}" fill="#E2E8F0" stroke="#334155" stroke-width="1.4"/>
        <line x1="${+(sx + sW * 0.2).toFixed(1)}" y1="${sy}" x2="${+(sx + sW * 0.2).toFixed(1)}" y2="${+(sy + sH).toFixed(1)}" stroke="#475569" stroke-width="1.1"/>
        <line x1="${+(sx + sW * 0.4).toFixed(1)}" y1="${sy}" x2="${+(sx + sW * 0.4).toFixed(1)}" y2="${+(sy + sH).toFixed(1)}" stroke="#475569" stroke-width="1.1"/>
        <line x1="${+(sx + sW * 0.6).toFixed(1)}" y1="${sy}" x2="${+(sx + sW * 0.6).toFixed(1)}" y2="${+(sy + sH).toFixed(1)}" stroke="#475569" stroke-width="1.1"/>
        <line x1="${+(sx + sW * 0.8).toFixed(1)}" y1="${sy}" x2="${+(sx + sW * 0.8).toFixed(1)}" y2="${+(sy + sH).toFixed(1)}" stroke="#475569" stroke-width="1.1"/>
        <line x1="${+(sx + 4).toFixed(1)}" y1="${+(sy + sH / 2).toFixed(1)}" x2="${+(sx + sW - 4).toFixed(1)}" y2="${+(sy + sH / 2).toFixed(1)}" stroke="#B45309" stroke-width="1.2"/>
      `;
    } else if (r.furniture === 'pooja' && rw > 40 && rh > 30) {
      roomElements += `
        <rect x="${+(rx + rw - 24).toFixed(1)}" y="${+(ry + 8).toFixed(1)}" width="15" height="15" rx="2.5" fill="#FEF08A" stroke="#B45309" stroke-width="1.4"/>
        <circle cx="${+(rx + rw - 16.5).toFixed(1)}" cy="${+(ry + 15.5).toFixed(1)}" r="3.5" fill="#F59E0B"/>
      `;
    } else if (r.furniture === 'car_bay' && rw > 55 && rh > 80) {
      const cw = Math.min(50, rw * 0.56);
      const ch = Math.min(90, rh * 0.60);
      const carX = +(cx - cw / 2).toFixed(1);
      const carY = +(ry + 12).toFixed(1);
      roomElements += `
        <rect x="${carX}" y="${carY}" width="${cw}" height="${ch}" rx="10" fill="#E2E8F0" stroke="#334155" stroke-width="1.8"/>
        <rect x="${+(carX + 5).toFixed(1)}" y="${+(carY + 14).toFixed(1)}" width="${+(cw - 10).toFixed(1)}" height="${+(ch * 0.48).toFixed(1)}" rx="5" fill="#BAE6FD" stroke="#0369A1" stroke-width="1.2"/>
        <rect x="${+(carX + 8).toFixed(1)}" y="${+(carY + 22).toFixed(1)}" width="${+(cw - 16).toFixed(1)}" height="${+(ch * 0.28).toFixed(1)}" rx="3" fill="#F8FAFC" stroke="#475569" stroke-width="1"/>
      `;
    }

    // Windows along outer walls
    for (const w of r.windows || []) {
      const winLen = Math.max(18, len(w.widthFt));
      if (w.wall === 'north') {
        const wx = +(rx + rw * w.offsetRatio - winLen / 2).toFixed(1);
        roomElements += `<rect x="${wx}" y="${+(ry - 3.5).toFixed(1)}" width="${winLen}" height="7" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.8"/><line x1="${wx}" y1="${ry}" x2="${+(wx + winLen).toFixed(1)}" y2="${ry}" stroke="#0369A1" stroke-width="1"/>`;
      } else if (w.wall === 'south') {
        const wx = +(rx + rw * w.offsetRatio - winLen / 2).toFixed(1);
        roomElements += `<rect x="${wx}" y="${+(ry + rh - 3.5).toFixed(1)}" width="${winLen}" height="7" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.8"/><line x1="${wx}" y1="${+(ry + rh).toFixed(1)}" x2="${+(wx + winLen).toFixed(1)}" y2="${+(ry + rh).toFixed(1)}" stroke="#0369A1" stroke-width="1"/>`;
      } else if (w.wall === 'west') {
        const wy = +(ry + rh * w.offsetRatio - winLen / 2).toFixed(1);
        roomElements += `<rect x="${+(rx - 3.5).toFixed(1)}" y="${wy}" width="7" height="${winLen}" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.8"/><line x1="${rx}" y1="${wy}" x2="${rx}" y2="${+(wy + winLen).toFixed(1)}" stroke="#0369A1" stroke-width="1"/>`;
      } else if (w.wall === 'east') {
        const wy = +(ry + rh * w.offsetRatio - winLen / 2).toFixed(1);
        roomElements += `<rect x="${+(rx + rw - 3.5).toFixed(1)}" y="${wy}" width="7" height="${winLen}" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.8"/><line x1="${+(rx + rw).toFixed(1)}" y1="${wy}" x2="${+(rx + rw).toFixed(1)}" y2="${+(wy + winLen).toFixed(1)}" stroke="#0369A1" stroke-width="1"/>`;
      }
    }

    // Doors with swing arcs
    for (const d of r.doors || []) {
      const doorLen = Math.max(16, Math.min(28, len(d.widthFt)));
      if (d.wall === 'south') {
        const dx = +(rx + rw * d.offsetRatio - doorLen / 2).toFixed(1);
        const dy = +(ry + rh).toFixed(1);
        roomElements += `
          <line x1="${dx}" y1="${dy}" x2="${+(dx + doorLen).toFixed(1)}" y2="${dy}" stroke="${fill}" stroke-width="7"/>
          <line x1="${dx}" y1="${dy}" x2="${dx}" y2="${+(dy - doorLen).toFixed(1)}" stroke="#B45309" stroke-width="2.2"/>
          <path d="M ${dx} ${+(dy - doorLen).toFixed(1)} A ${doorLen} ${doorLen} 0 0 1 ${+(dx + doorLen).toFixed(1)} ${dy}" fill="none" stroke="#D97706" stroke-width="1.4" stroke-dasharray="3 2"/>
        `;
      } else if (d.wall === 'north') {
        const dx = +(rx + rw * d.offsetRatio - doorLen / 2).toFixed(1);
        const dy = ry;
        roomElements += `
          <line x1="${dx}" y1="${dy}" x2="${+(dx + doorLen).toFixed(1)}" y2="${dy}" stroke="${fill}" stroke-width="7"/>
          <line x1="${dx}" y1="${dy}" x2="${dx}" y2="${+(dy + doorLen).toFixed(1)}" stroke="#B45309" stroke-width="2.2"/>
          <path d="M ${dx} ${+(dy + doorLen).toFixed(1)} A ${doorLen} ${doorLen} 0 0 0 ${+(dx + doorLen).toFixed(1)} ${dy}" fill="none" stroke="#D97706" stroke-width="1.4" stroke-dasharray="3 2"/>
        `;
      } else if (d.wall === 'west') {
        const dx = rx;
        const dy = +(ry + rh * d.offsetRatio - doorLen / 2).toFixed(1);
        roomElements += `
          <line x1="${dx}" y1="${dy}" x2="${dx}" y2="${+(dy + doorLen).toFixed(1)}" stroke="${fill}" stroke-width="7"/>
          <line x1="${dx}" y1="${dy}" x2="${+(dx + doorLen).toFixed(1)}" y2="${dy}" stroke="#B45309" stroke-width="2.2"/>
          <path d="M ${+(dx + doorLen).toFixed(1)} ${dy} A ${doorLen} ${doorLen} 0 0 1 ${dx} ${+(dy + doorLen).toFixed(1)}" fill="none" stroke="#D97706" stroke-width="1.4" stroke-dasharray="3 2"/>
        `;
      } else if (d.wall === 'east') {
        const dx = +(rx + rw).toFixed(1);
        const dy = +(ry + rh * d.offsetRatio - doorLen / 2).toFixed(1);
        roomElements += `
          <line x1="${dx}" y1="${dy}" x2="${dx}" y2="${+(dy + doorLen).toFixed(1)}" stroke="${fill}" stroke-width="7"/>
          <line x1="${dx}" y1="${dy}" x2="${+(dx - doorLen).toFixed(1)}" y2="${dy}" stroke="#B45309" stroke-width="2.2"/>
          <path d="M ${+(dx - doorLen).toFixed(1)} ${dy} A ${doorLen} ${doorLen} 0 0 0 ${dx} ${+(dy + doorLen).toFixed(1)}" fill="none" stroke="#D97706" stroke-width="1.4" stroke-dasharray="3 2"/>
        `;
      }
    }

    // Room Code, Name, Dimensions, and Area Labels
    const fontSizeTitle = rw < 95 || rh < 65 ? 10 : 12.5;
    const fontSizeDim = rw < 95 || rh < 65 ? 9.5 : 11;
    const labelW = Math.min(rw - 8, Math.max(96, r.name.length * 6.8 + 18));
    const labelH = rh < 54 ? 34 : 42;
    roomElements += `
        <rect x="${+(cx - labelW / 2).toFixed(1)}" y="${+(cy - labelH / 2 + 2).toFixed(1)}" width="${+labelW.toFixed(1)}" height="${labelH}" rx="5" fill="#FFFFFF" fill-opacity="0.88" stroke="#CBD5E1" stroke-width="1"/>
        <text x="${cx}" y="${+(cy - 9).toFixed(1)}" text-anchor="middle" fill="#B45309" font-family="Arial, sans-serif" font-size="${fontSizeTitle - 2}" font-weight="bold" letter-spacing="0.8">${escXml(r.code)}</text>
        <text x="${cx}" y="${+(cy + 4).toFixed(1)}" text-anchor="middle" fill="#0F172A" font-family="Arial, sans-serif" font-size="${fontSizeTitle}" font-weight="bold">${escXml(r.name)}</text>
        <text x="${cx}" y="${+(cy + 18).toFixed(1)}" text-anchor="middle" fill="#334155" font-family="monospace" font-size="${fontSizeDim}" font-weight="bold">${r.width}' × ${r.depth}' (${r.areaSqFt} sq.ft)</text>
      </g>
    `;
  }

  const envX = px(envelope.x);
  const envY = py(envelope.y);
  const envW = len(envelope.widthFt);
  const envH = len(envelope.depthFt);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">
  <defs>
    <pattern id="cadGrid" width="25" height="25" patternUnits="userSpaceOnUse">
      <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#E2E8F0" stroke-width="0.9"/>
    </pattern>
    <pattern id="woodFloorPat" width="24" height="12" patternUnits="userSpaceOnUse">
      <rect width="24" height="12" fill="#F5E6D3"/>
      <line x1="0" y1="6" x2="24" y2="6" stroke="#E2C7A8" stroke-width="0.8"/>
      <line x1="0" y1="12" x2="24" y2="12" stroke="#E2C7A8" stroke-width="0.8"/>
      <line x1="12" y1="0" x2="12" y2="6" stroke="#E2C7A8" stroke-width="0.7"/>
      <line x1="20" y1="6" x2="20" y2="12" stroke="#E2C7A8" stroke-width="0.7"/>
    </pattern>
    <pattern id="livingFloorPat" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect width="24" height="24" fill="#FDF6EC"/>
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#EADBC8" stroke-width="0.9"/>
    </pattern>
    <pattern id="wetTilePat" width="14" height="14" patternUnits="userSpaceOnUse">
      <rect width="14" height="14" fill="#E0F2FE"/>
      <path d="M 14 0 L 0 0 0 14" fill="none" stroke="#BAE6FD" stroke-width="0.9"/>
    </pattern>
    <pattern id="parkingPat" width="18" height="18" patternUnits="userSpaceOnUse">
      <rect width="18" height="18" fill="#E2E8F0"/>
      <path d="M 18 0 L 0 0 0 18" fill="none" stroke="#CBD5E1" stroke-width="1"/>
    </pattern>
  </defs>

  <!-- CAD Sheet Background -->
  <rect width="${svgW}" height="${svgH}" fill="#FAF8F5"/>
  <rect x="20" y="20" width="${svgW - 40}" height="${svgH - 40}" fill="#FFFFFF" stroke="#B45309" stroke-opacity="0.55" stroke-width="2"/>
  <rect x="20" y="94" width="${svgW - 40}" height="${svgH - 114}" fill="url(#cadGrid)"/>

  <!-- Top Header Banner -->
  <rect x="20" y="20" width="${svgW - 40}" height="74" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.2"/>
  <text x="44" y="49" fill="#B45309" font-family="Arial, sans-serif" font-size="13" font-weight="bold" letter-spacing="1.5">BOOLOK BIM SPECIFICATION CORE · PHASE 3 ORTHOGRAPHIC CAD SHEET</text>
  <text x="44" y="75" fill="#0F172A" font-family="Arial, sans-serif" font-size="20" font-weight="bold">2D ARCHITECTURAL FLOOR PLAN — ${plot.rawWidth} × ${plot.rawDepth} ${plot.displayUnit.toUpperCase()} (${program.bedrooms} BHK · ${program.stories === 1 ? 'GROUND FLOOR' : `G+${program.stories - 1}`})</text>

  <!-- Compass / North Arrow -->
  <g transform="translate(${svgW - 85}, 57)">
    <circle cx="0" cy="0" r="22" fill="#FFFFFF" stroke="#B45309" stroke-width="1.8"/>
    <polygon points="0,-16 -6,6 0,2 6,6" fill="#B45309"/>
    <text x="0" y="17" text-anchor="middle" fill="#0F172A" font-family="Arial, sans-serif" font-size="9.5" font-weight="bold">N</text>
  </g>

  <!-- Outer Plot Boundary -->
  <rect x="${ox}" y="${oy}" width="${drawPlotW}" height="${drawPlotH}" fill="#F1F5F9" stroke="#334155" stroke-width="2.5" stroke-dasharray="10 5"/>

  <!-- Setback-Constrained Buildable Envelope Outline -->
  <rect x="${envX}" y="${envY}" width="${envW}" height="${envH}" fill="#FFFFFF" stroke="#16A34A" stroke-opacity="0.85" stroke-width="1.8" stroke-dasharray="5 4"/>

  <!-- Placed Rooms, Walls, Doors, Windows & Annotations -->
  ${roomElements}

  <!-- Outer Plot Dimension Callouts -->
  <line x1="${ox}" y1="${+(oy - 22).toFixed(1)}" x2="${+(ox + drawPlotW).toFixed(1)}" y2="${+(oy - 22).toFixed(1)}" stroke="#0F172A" stroke-width="1.6"/>
  <text x="${+(ox + drawPlotW / 2).toFixed(1)}" y="${+(oy - 28).toFixed(1)}" text-anchor="middle" fill="#0F172A" font-family="monospace" font-size="12" font-weight="bold">PLOT WIDTH: ${plot.widthFt}' (${envelope.widthFt}' BUILDABLE ENVELOPE)</text>

  <line x1="${+(ox - 24).toFixed(1)}" y1="${oy}" x2="${+(ox - 24).toFixed(1)}" y2="${+(oy + drawPlotH).toFixed(1)}" stroke="#0F172A" stroke-width="1.6"/>
  <text x="${+(ox - 34).toFixed(1)}" y="${+(oy + drawPlotH / 2).toFixed(1)}" text-anchor="middle" fill="#0F172A" font-family="monospace" font-size="12" font-weight="bold" transform="rotate(-90 ${+(ox - 34).toFixed(1)} ${+(oy + drawPlotH / 2).toFixed(1)})">PLOT DEPTH: ${plot.depthFt}' (${envelope.depthFt}' ENVELOPE)</text>

  <!-- Setback Callout Labels -->
  <text x="${+(ox + drawPlotW / 2).toFixed(1)}" y="${+(oy + 14).toFixed(1)}" text-anchor="middle" fill="#0369A1" font-family="monospace" font-size="10.5" font-weight="bold">REAR SETBACK: ${setbacks.rearFt} FT</text>
  <text x="${+(ox + drawPlotW / 2).toFixed(1)}" y="${+(oy + drawPlotH - 6).toFixed(1)}" text-anchor="middle" fill="#0369A1" font-family="monospace" font-size="10.5" font-weight="bold">FRONT SETBACK: ${setbacks.frontFt} FT  |  LEFT: ${setbacks.leftFt} FT  |  RIGHT: ${setbacks.rightFt} FT</text>

  <!-- Front Access Road Banner -->
  <rect x="${ox}" y="${+(oy + drawPlotH + 12).toFixed(1)}" width="${drawPlotW}" height="34" rx="4" fill="#334155" stroke="#0F172A" stroke-width="1.2"/>
  <text x="${+(ox + drawPlotW / 2).toFixed(1)}" y="${+(oy + drawPlotH + 33).toFixed(1)}" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="12" font-weight="bold" letter-spacing="1.2">PRIMARY ACCESS ROAD (${plot.facing.toUpperCase()} FRONTAGE · ${plot.roadWidth} FT ROW)</text>

  <!-- Bottom Architectural Title Block & Area Verification Schedule -->
  <rect x="36" y="940" width="${svgW - 72}" height="202" rx="8" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.6"/>
  <line x1="36" y1="978" x2="${svgW - 36}" y2="978" stroke="#CBD5E1" stroke-width="1.2"/>
  <text x="54" y="964" fill="#B45309" font-family="Arial, sans-serif" font-size="12" font-weight="bold" letter-spacing="1">CANONICAL AREA &amp; GEOMETRY SCHEDULE (DERIVED FROM UNIFIED LAYOUT MODEL)</text>
  <text x="${svgW - 54}" y="964" text-anchor="end" fill="#15803D" font-family="monospace" font-size="11" font-weight="bold">GEOMETRY VALIDATED · ZERO ROOM OVERLAP</text>

  <!-- 3 Columns in Title Block -->
  <text x="54" y="1004" fill="#475569" font-family="Arial, sans-serif" font-size="12">1. Gross Plot Area (${plot.widthFt}' × ${plot.depthFt}'):</text>
  <text x="330" y="1004" text-anchor="end" fill="#0F172A" font-family="monospace" font-size="12" font-weight="bold">${areas.plotAreaSqFt.toLocaleString()} sq.ft</text>

  <text x="54" y="1028" fill="#475569" font-family="Arial, sans-serif" font-size="12">2. Setback-Constrained Envelope (${envelope.widthFt}' × ${envelope.depthFt}'):</text>
  <text x="330" y="1028" text-anchor="end" fill="#0369A1" font-family="monospace" font-size="12" font-weight="bold">${areas.buildingEnvelopeSqFt.toLocaleString()} sq.ft</text>

  <text x="54" y="1052" fill="#475569" font-family="Arial, sans-serif" font-size="12">3. Ground Enclosed + Semi-Open Built-Up:</text>
  <text x="330" y="1052" text-anchor="end" fill="#15803D" font-family="monospace" font-size="12" font-weight="bold">${areas.groundFloorFootprintSqFt.toLocaleString()} sq.ft (${areas.groundCoveragePct}%)</text>

  <text x="54" y="1076" fill="#475569" font-family="Arial, sans-serif" font-size="12">4. Total Multi-Floor Built-Up (${program.stories} Floor${program.stories > 1 ? 's' : ''}):</text>
  <text x="330" y="1076" text-anchor="end" fill="#B45309" font-family="monospace" font-size="12" font-weight="bold">${areas.totalBuiltUpAreaSqFt.toLocaleString()} sq.ft</text>

  <text x="54" y="1100" fill="#475569" font-family="Arial, sans-serif" font-size="12">5. Unobstructed Setback Open Space:</text>
  <text x="330" y="1100" text-anchor="end" fill="#334155" font-family="monospace" font-size="12" font-weight="bold">${areas.setbackOpenAreaSqFt.toLocaleString()} sq.ft</text>

  <line x1="360" y1="984" x2="360" y2="1132" stroke="#CBD5E1" stroke-width="1.2"/>

  <text x="382" y="1002" fill="#B45309" font-family="Arial, sans-serif" font-size="11" font-weight="bold">ROOM SCHEDULE (${rooms.length} ZONES PLACED ON GROUND LEVEL):</text>
  ${rooms
    .slice(0, 10)
    .map((r, idx) => {
      const col = idx < 5 ? 382 : 680;
      const rowY = 1024 + (idx % 5) * 19;
      return `<text x="${col}" y="${rowY}" fill="#0F172A" font-family="monospace" font-size="10.5" font-weight="bold">${escXml(r.code)} ${escXml(r.name.slice(0, 20))}: ${r.width}'×${r.depth}' (${r.areaSqFt} sf)</text>`;
    })
    .join('\n  ')}

  <text x="54" y="1127" fill="#64748B" font-family="Arial, sans-serif" font-size="10">Setback Basis: ${escXml(setbacks.source)} · Conceptual architectural layout preview only (not a municipal zoning permit or structural engineering stamp).</text>
</svg>`;
}

/**
 * Generates a matching 3D Axonometric / Isometric Cutaway Preview SVG
 * projected directly from the exact same canonical room coordinates (x, y, width, depth)
 * as the 2D floor plan so room positions, dimensions, and orientation never disagree.
 */
function render3DCutawaySvg(model) {
  const { plot, setbacks, envelope, areas, rooms, program } = model;
  const svgW = 1000;
  const svgH = 1100;
  const cos30 = 0.866025;
  const sin30 = 0.5;
  const wallH = 9.5; // 9.5 ft cutaway wall height

  const rawPts = [
    [0, 0, 0],
    [plot.widthFt, 0, 0],
    [plot.widthFt, plot.depthFt, 0],
    [0, plot.depthFt, 0],
    [0, 0, wallH],
    [plot.widthFt, 0, wallH],
    [plot.widthFt, plot.depthFt, wallH],
    [0, plot.depthFt, wallH],
    [0, plot.depthFt + 3.5, -1.8],
  ];
  let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
  for (const [rx, ry, rz] of rawPts) {
    const ux = (rx - ry) * cos30;
    const uy = (rx + ry) * sin30 - rz * 0.92;
    if (ux < uMinX) uMinX = ux;
    if (ux > uMaxX) uMaxX = ux;
    if (uy < uMinY) uMinY = uy;
    if (uy > uMaxY) uMaxY = uy;
  }

  const targetW = 860;
  const targetH = 740;
  const isoScale = +(Math.min(targetW / Math.max(1, uMaxX - uMinX), targetH / Math.max(1, uMaxY - uMinY), 22)).toFixed(2);
  const centerX = 500;
  const centerY = 505;
  const originX = +(centerX - ((uMinX + uMaxX) / 2) * isoScale).toFixed(1);
  const originY = +(centerY - ((uMinY + uMaxY) / 2) * isoScale).toFixed(1);

  const isoPt = (xFt, yFt, zFt = 0) => {
    const sx = originX + (xFt - yFt) * cos30 * isoScale;
    const sy = originY + (xFt + yFt) * sin30 * isoScale - zFt * isoScale * 0.92;
    return [+(sx).toFixed(1), +(sy).toFixed(1)];
  };

  const polyStr = (pts) => pts.map((p) => `${p[0]},${p[1]}`).join(' ');

  const isoBox = (bx0, by0, bx1, by1, bz0, bz1, topFill, leftFill, rightFill, strokeCol = '#1E293B') => {
    const topP = [isoPt(bx0, by0, bz1), isoPt(bx1, by0, bz1), isoPt(bx1, by1, bz1), isoPt(bx0, by1, bz1)];
    const southP = [isoPt(bx0, by1, bz0), isoPt(bx1, by1, bz0), isoPt(bx1, by1, bz1), isoPt(bx0, by1, bz1)];
    const eastP = [isoPt(bx1, by0, bz0), isoPt(bx1, by1, bz0), isoPt(bx1, by1, bz1), isoPt(bx1, by0, bz1)];
    return `
      <polygon points="${polyStr(southP)}" fill="${leftFill}" stroke="${strokeCol}" stroke-width="0.9"/>
      <polygon points="${polyStr(eastP)}" fill="${rightFill}" stroke="${strokeCol}" stroke-width="0.9"/>
      <polygon points="${polyStr(topP)}" fill="${topFill}" stroke="${strokeCol}" stroke-width="1"/>
    `;
  };

  const floorColors = {
    private: 'url(#isoWoodFloor)',
    public: 'url(#isoMarbleFloor)',
    wet: 'url(#isoWetFloor)',
    circulation: '#E2E8F0',
    service: '#CBD5E1',
    parking: '#94A3B8',
  };

  // Sort rooms back-to-front in isometric painter's order ((x + y) ascending)
  const sortedRooms = [...rooms].sort((a, b) => a.x + a.y - (b.x + b.y));

  // Plot base slab
  const plotSlabPts = [
    isoPt(0, 0, 0),
    isoPt(plot.widthFt, 0, 0),
    isoPt(plot.widthFt, plot.depthFt, 0),
    isoPt(0, plot.depthFt, 0),
  ];

  const plotSlabBottomPts = [
    isoPt(0, plot.depthFt, -1.6),
    isoPt(plot.widthFt, plot.depthFt, -1.6),
    isoPt(plot.widthFt, 0, -1.6),
  ];

  // Envelope boundary on ground
  const envPts = [
    isoPt(envelope.x, envelope.y, 0.1),
    isoPt(envelope.x + envelope.widthFt, envelope.y, 0.1),
    isoPt(envelope.x + envelope.widthFt, envelope.y + envelope.depthFt, 0.1),
    isoPt(envelope.x, envelope.y + envelope.depthFt, 0.1),
  ];

  let isoRoomsSvg = '';

  for (const r of sortedRooms) {
    const x0 = r.x;
    const y0 = r.y;
    const x1 = +(r.x + r.width).toFixed(2);
    const y1 = +(r.y + r.depth).toFixed(2);
    const h = r.isSemiOpen ? 3.8 : wallH;
    const frontCutH = r.isSemiOpen ? 1.8 : 2.6;
    const wallT = 0.65;
    const floorFill = floorColors[r.category] || '#E2E8F0';

    // Floor tile polygon
    const fPts = [isoPt(x0, y0, 0.2), isoPt(x1, y0, 0.2), isoPt(x1, y1, 0.2), isoPt(x0, y1, 0.2)];

    // Back-Left (North, y = y0) & Back-Right (West, x = x0) interior wall faces
    const northWallPts = [isoPt(x0, y0, 0.2), isoPt(x1, y0, 0.2), isoPt(x1, y0, h), isoPt(x0, y0, h)];
    const westWallPts = [isoPt(x0, y0, 0.2), isoPt(x0, y1, 0.2), isoPt(x0, y1, h), isoPt(x0, y0, h)];

    // Front-Right (East, x = x1) & Front-Left (South, y = y1) cutaway low walls
    const eastWallPts = [isoPt(x1, y0, 0.2), isoPt(x1, y1, 0.2), isoPt(x1, y1, frontCutH), isoPt(x1, y0, frontCutH)];
    const southWallPts = [isoPt(x0, y1, 0.2), isoPt(x1, y1, 0.2), isoPt(x1, y1, frontCutH), isoPt(x0, y1, frontCutH)];

    const northWallCap = [isoPt(x0, y0, h), isoPt(x1, y0, h), isoPt(x1, y0 + wallT, h), isoPt(x0, y0 + wallT, h)];
    const westWallCap = [isoPt(x0, y0, h), isoPt(x0 + wallT, y0, h), isoPt(x0 + wallT, y1, h), isoPt(x0, y1, h)];
    const eastWallCap = [isoPt(x1 - wallT, y0, frontCutH), isoPt(x1, y0, frontCutH), isoPt(x1, y1, frontCutH), isoPt(x1 - wallT, y1, frontCutH)];
    const southWallCap = [isoPt(x0, y1 - wallT, frontCutH), isoPt(x1, y1 - wallT, frontCutH), isoPt(x1, y1, frontCutH), isoPt(x0, y1, frontCutH)];

    // Center point for room label at rear wall top
    const [cx, cy] = isoPt((x0 + x1) / 2, y0 + r.depth * 0.28, h + 0.6);

    // 3D Volumetric Furniture inside room
    let furnSvg = '';
    if (r.furniture === 'bed_double' && r.width >= 7 && r.depth >= 7) {
      const bx0 = x0 + 1.2;
      const by0 = y0 + 0.85;
      const bx1 = Math.min(x1 - 1.4, bx0 + 6.0);
      const by1 = Math.min(y1 - 1.2, by0 + 6.4);
      const rugPts = [isoPt(bx0 - 0.5, by0 + 1.0, 0.25), isoPt(bx1 + 0.5, by0 + 1.0, 0.25), isoPt(bx1 + 0.5, by1 + 0.5, 0.25), isoPt(bx0 - 0.5, by1 + 0.5, 0.25)];
      furnSvg += `<polygon points="${polyStr(rugPts)}" fill="#FDE68A" fill-opacity="0.7" stroke="#D97706" stroke-width="0.9"/>`;
      if (bx0 - x0 > 0.9) {
        furnSvg += isoBox(x0 + 0.35, by0, bx0 - 0.15, by0 + 1.2, 0.2, 1.8, '#92400E', '#451A03', '#78350F');
      }
      furnSvg += isoBox(bx0, by0, bx1, by0 + 0.5, 0.2, 4.0, '#78350F', '#451A03', '#5C2406');
      furnSvg += isoBox(bx0, by0 + 0.5, bx1, by1, 0.2, 1.9, '#FFFBEB', '#CBD5E1', '#E2E8F0');
      furnSvg += isoBox(bx0 + 0.1, by0 + 2.2, bx1 - 0.1, by1, 1.9, 2.15, '#F59E0B', '#B45309', '#D97706');
      furnSvg += isoBox(bx0 + 0.45, by0 + 0.7, (bx0 + bx1) / 2 - 0.15, by0 + 1.8, 1.9, 2.35, '#FFFFFF', '#CBD5E1', '#F1F5F9');
      furnSvg += isoBox((bx0 + bx1) / 2 + 0.15, by0 + 0.7, bx1 - 0.45, by0 + 1.8, 1.9, 2.35, '#FFFFFF', '#CBD5E1', '#F1F5F9');
      if (x1 - bx1 > 2.0) {
        furnSvg += isoBox(x1 - 1.7, y0 + 0.9, x1 - 0.35, Math.min(y1 - 1.0, y0 + 6.2), 0.2, 6.8, '#B45309', '#78350F', '#92400E');
      }
    } else if (r.furniture === 'bed_twin' && r.width >= 6.5 && r.depth >= 6.5) {
      const bx0 = x0 + 1.0;
      const by0 = y0 + 0.85;
      const bx1 = Math.min(x1 - 1.0, bx0 + 4.8);
      const by1 = Math.min(y1 - 1.0, by0 + 6.0);
      const rugPts = [isoPt(bx0 - 0.4, by0 + 1.0, 0.25), isoPt(bx1 + 0.4, by0 + 1.0, 0.25), isoPt(bx1 + 0.4, by1 + 0.4, 0.25), isoPt(bx0 - 0.4, by1 + 0.4, 0.25)];
      furnSvg += `<polygon points="${polyStr(rugPts)}" fill="#BAE6FD" fill-opacity="0.65" stroke="#0284C7" stroke-width="0.9"/>`;
      furnSvg += isoBox(bx0, by0, bx1, by0 + 0.45, 0.2, 3.6, '#78350F', '#451A03', '#5C2406');
      furnSvg += isoBox(bx0, by0 + 0.45, bx1, by1, 0.2, 1.85, '#F8FAFC', '#CBD5E1', '#E2E8F0');
      furnSvg += isoBox(bx0 + 0.1, by0 + 2.1, bx1 - 0.1, by1, 1.85, 2.1, '#38BDF8', '#0369A1', '#0284C7');
      furnSvg += isoBox(bx0 + 0.5, by0 + 0.7, bx1 - 0.5, by0 + 1.7, 1.85, 2.3, '#FFFFFF', '#E2E8F0', '#F1F5F9');
      if (x1 - bx1 > 1.8) {
        furnSvg += isoBox(x1 - 1.5, y0 + 0.9, x1 - 0.35, Math.min(y1 - 1.0, y0 + 5.2), 0.2, 6.4, '#B45309', '#78350F', '#92400E');
      }
    } else if (r.furniture === 'living_sofa' && r.width >= 7 && r.depth >= 6.5) {
      const sx0 = x0 + 1.1;
      const sy0 = y0 + 1.0;
      const sx1 = Math.min(x1 - 1.4, sx0 + 7.4);
      const sy1 = Math.min(y1 - 1.4, sy0 + 2.8);
      const rugPts = [isoPt(sx0 + 1.8, sy1 + 0.2, 0.25), isoPt(Math.min(x1 - 1.0, sx1 + 0.4), sy1 + 0.2, 0.25), isoPt(Math.min(x1 - 1.0, sx1 + 0.4), Math.min(y1 - 0.8, sy1 + 3.4), 0.25), isoPt(sx0 + 1.8, Math.min(y1 - 0.8, sy1 + 3.4), 0.25)];
      furnSvg += `<polygon points="${polyStr(rugPts)}" fill="#FED7AA" fill-opacity="0.7" stroke="#C2410C" stroke-width="0.9"/>`;
      furnSvg += isoBox(sx0, sy0, sx1, sy0 + 0.7, 0.2, 3.0, '#9A3412', '#431407', '#7C2D12');
      furnSvg += isoBox(sx0, sy0 + 0.7, sx1, sy1, 0.2, 1.65, '#FB923C', '#C2410C', '#EA580C');
      furnSvg += isoBox(sx0, sy1, sx0 + 2.4, Math.min(y1 - 1.1, sy1 + 3.4), 0.2, 1.65, '#FB923C', '#C2410C', '#EA580C');
      if (sy1 + 2.6 < y1 - 0.8) {
        furnSvg += isoBox(sx0 + 2.9, sy1 + 0.7, Math.min(x1 - 1.5, sx0 + 6.4), sy1 + 2.3, 0.2, 1.35, '#FFF7ED', '#78350F', '#92400E');
      }
      if (x1 - sx0 > 6.5) {
        furnSvg += isoBox(x1 - 1.3, y0 + 1.8, x1 - 0.4, Math.min(y1 - 1.4, y0 + 6.0), 0.2, 2.2, '#334155', '#0F172A', '#1E293B');
      }
    } else if (r.furniture === 'dining_table' && r.width >= 6.5 && r.depth >= 6) {
      const tx0 = x0 + Math.max(1.4, r.width * 0.2);
      const ty0 = y0 + Math.max(1.2, r.depth * 0.22);
      const tx1 = Math.min(x1 - 1.4, tx0 + 5.6);
      const ty1 = Math.min(y1 - 1.2, ty0 + 3.4);
      furnSvg += isoBox(tx0, ty0, tx1, ty1, 0.2, 2.55, '#F59E0B', '#78350F', '#B45309');
      furnSvg += isoBox(tx0 + 0.5, ty0 - 0.75, tx0 + 1.7, ty0 - 0.1, 0.2, 1.7, '#FEF3C7', '#92400E', '#D97706');
      furnSvg += isoBox(tx1 - 1.7, ty0 - 0.75, tx1 - 0.5, ty0 - 0.1, 0.2, 1.7, '#FEF3C7', '#92400E', '#D97706');
      furnSvg += isoBox(tx0 + 0.5, ty1 + 0.1, tx0 + 1.7, ty1 + 0.75, 0.2, 1.7, '#FEF3C7', '#92400E', '#D97706');
      furnSvg += isoBox(tx1 - 1.7, ty1 + 0.1, tx1 - 0.5, ty1 + 0.75, 0.2, 1.7, '#FEF3C7', '#92400E', '#D97706');
    } else if (r.furniture === 'kitchen_counter' && r.width >= 5.5 && r.depth >= 5.5) {
      const kx0 = Math.max(x0 + 1.0, x1 - 2.3);
      const ky0 = y0 + 0.85;
      const kx1 = x1 - 0.35;
      const ky1 = y1 - 0.6;
      furnSvg += isoBox(x0 + 0.6, y0 + 0.6, Math.min(kx0 - 0.3, x0 + 2.6), y0 + 2.5, 0.2, 6.2, '#E2E8F0', '#475569', '#64748B');
      furnSvg += isoBox(kx0, ky0, kx1, ky1, 0.2, 2.95, '#F8FAFC', '#475569', '#64748B');
      furnSvg += isoBox(x0 + 1.0, Math.max(y0 + 1.0, y1 - 2.3), kx0, ky1, 0.2, 2.95, '#F8FAFC', '#475569', '#64748B');
      furnSvg += isoBox(kx0 + 0.25, ky0 + 1.0, kx1 - 0.25, Math.min(ky1 - 1.0, ky0 + 2.8), 2.95, 3.12, '#38BDF8', '#0284C7', '#0369A1');
      furnSvg += isoBox(x0 + 1.6, Math.max(y0 + 1.2, y1 - 2.0), Math.min(kx0 - 0.3, x0 + 3.8), ky1 - 0.25, 2.95, 3.12, '#1E293B', '#0F172A', '#334155');
    } else if (r.furniture === 'bath_fixtures' && r.width >= 4 && r.depth >= 4) {
      furnSvg += isoBox(x0 + 0.6, y0 + 0.6, Math.min(x1 - 0.6, x0 + 2.4), Math.min(y1 - 0.6, y0 + 2.0), 0.2, 2.65, '#FFFFFF', '#94A3B8', '#CBD5E1');
      furnSvg += isoBox(Math.max(x0 + 0.8, x1 - 2.2), y0 + 0.6, x1 - 0.5, Math.min(y1 - 0.6, y0 + 2.2), 0.2, 1.9, '#E0F2FE', '#0284C7', '#38BDF8');
    } else if (r.furniture === 'stairs' && r.width >= 5 && r.depth >= 3.2) {
      for (let s = 0; s < 5; s++) {
        const sx0 = x0 + 0.7 + s * ((r.width - 1.4) / 5);
        const sx1 = sx0 + (r.width - 1.4) / 5;
        furnSvg += isoBox(sx0, y0 + 0.55, sx1, y1 - 0.55, 0.2, 1.1 + s * 1.25, '#E2E8F0', '#475569', '#64748B');
      }
    } else if (r.furniture === 'car_bay' && r.width >= 7 && r.depth >= 9) {
      const cx0 = x0 + Math.max(1.2, (r.width - 5.4) / 2);
      const cy0 = y0 + Math.max(1.4, (r.depth - 10.5) / 2);
      const cx1 = Math.min(x1 - 1.2, cx0 + 5.4);
      const cy1 = Math.min(y1 - 1.4, cy0 + 10.5);
      furnSvg += isoBox(cx0, cy0, cx1, cy1, 0.3, 2.35, '#38BDF8', '#0369A1', '#0284C7');
      furnSvg += isoBox(cx0 + 0.4, cy0 + 2.2, cx1 - 0.4, cy1 - 2.0, 2.35, 3.85, '#E0F2FE', '#0284C7', '#38BDF8');
    }

    isoRoomsSvg += `
      <g>
        <!-- Room Floor Slab -->
        <polygon points="${polyStr(fPts)}" fill="${floorFill}" stroke="#475569" stroke-width="1.3"/>
        <!-- Rear/Side Walls (Shaded) -->
        <polygon points="${polyStr(northWallPts)}" fill="url(#isoNorthWall)" stroke="#64748B" stroke-width="1.1"/>
        <polygon points="${polyStr(westWallPts)}" fill="url(#isoWestWall)" stroke="#64748B" stroke-width="1.1"/>
        <polygon points="${polyStr(northWallCap)}" fill="#F8FAFC" stroke="#475569" stroke-width="0.9"/>
        <polygon points="${polyStr(westWallCap)}" fill="#E2E8F0" stroke="#475569" stroke-width="0.9"/>
        ${furnSvg}
        <!-- Front/Cutaway Walls (Low cutaway walls) -->
        <polygon points="${polyStr(eastWallPts)}" fill="#94A3B8" fill-opacity="0.55" stroke="#64748B" stroke-width="1"/>
        <polygon points="${polyStr(southWallPts)}" fill="#64748B" fill-opacity="0.55" stroke="#64748B" stroke-width="1"/>
        <polygon points="${polyStr(eastWallCap)}" fill="#E2E8F0" fill-opacity="0.85" stroke="#475569" stroke-width="0.8"/>
        <polygon points="${polyStr(southWallCap)}" fill="#CBD5E1" fill-opacity="0.85" stroke="#475569" stroke-width="0.8"/>
        <!-- Room Label Badge -->
        <rect x="${+(cx - 64).toFixed(1)}" y="${+(cy - 16).toFixed(1)}" width="128" height="31" rx="5" fill="#070E1A" fill-opacity="0.90" stroke="#DAA520" stroke-opacity="0.9" stroke-width="1.1"/>
        <text x="${cx}" y="${+(cy - 3).toFixed(1)}" text-anchor="middle" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="10" font-weight="bold">${escXml(r.code)} · ${escXml(r.name.slice(0, 18))}</text>
        <text x="${cx}" y="${+(cy + 10).toFixed(1)}" text-anchor="middle" fill="#DAA520" font-family="monospace" font-size="9" font-weight="bold">${r.width}' × ${r.depth}' (${r.areaSqFt} sf)</text>
      </g>
    `;
  }

  const [roadLabelX, roadLabelY] = isoPt(plot.widthFt / 2, plot.depthFt + 2.8, 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">
  <defs>
    <linearGradient id="bgGrad3D" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B1528"/>
      <stop offset="100%" stop-color="#16243D"/>
    </linearGradient>
    <linearGradient id="isoNorthWall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F1F5F9"/>
      <stop offset="100%" stop-color="#CBD5E1"/>
    </linearGradient>
    <linearGradient id="isoWestWall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E2E8F0"/>
      <stop offset="100%" stop-color="#94A3B8"/>
    </linearGradient>
    <linearGradient id="isoWoodFloor" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E6C9A8"/>
      <stop offset="100%" stop-color="#C89F74"/>
    </linearGradient>
    <linearGradient id="isoMarbleFloor" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F5EBE0"/>
      <stop offset="100%" stop-color="#D5BDAF"/>
    </linearGradient>
    <linearGradient id="isoWetFloor" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E0F2FE"/>
      <stop offset="100%" stop-color="#7DD3FC"/>
    </linearGradient>
  </defs>

  <rect width="${svgW}" height="${svgH}" fill="url(#bgGrad3D)"/>
  <rect x="20" y="20" width="${svgW - 40}" height="${svgH - 40}" fill="none" stroke="#DAA520" stroke-opacity="0.55" stroke-width="2"/>

  <!-- Header Banner -->
  <rect x="20" y="20" width="${svgW - 40}" height="74" fill="#0B1526" stroke="#DAA520" stroke-opacity="0.45" stroke-width="1"/>
  <text x="44" y="52" fill="#DAA520" font-family="Arial, sans-serif" font-size="13" font-weight="bold" letter-spacing="1.5">BOOLOK BIM SPECIFICATION CORE · PHASE 4 ISOMETRIC CUTAWAY PREVIEW</text>
  <text x="44" y="76" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="20" font-weight="bold">3D ARCHITECTURAL CUTAWAY PREVIEW — ${plot.rawWidth} × ${plot.rawDepth} ${plot.displayUnit.toUpperCase()} (${program.bedrooms} BHK)</text>

  <!-- Plot Ground Plinth & Setback Apron -->
  <polygon points="${polyStr(plotSlabPts)}" fill="#1E293B" stroke="#64748B" stroke-width="2.2"/>
  <polyline points="${polyStr([plotSlabPts[3], plotSlabBottomPts[0], plotSlabBottomPts[1], plotSlabPts[2]])}" fill="#0F172A" stroke="#475569" stroke-width="1.5"/>
  <polyline points="${polyStr([plotSlabPts[2], plotSlabBottomPts[1], plotSlabBottomPts[2], plotSlabPts[1]])}" fill="#131E31" stroke="#475569" stroke-width="1.5"/>

  <!-- Buildable Envelope Footprint Outline -->
  <polygon points="${polyStr(envPts)}" fill="none" stroke="#22C55E" stroke-width="1.8" stroke-dasharray="6 4"/>

  <!-- Extruded 3D Rooms Projected From Exact 2D Coordinates -->
  ${isoRoomsSvg}

  <!-- Front Road Orientation Callout -->
  <text x="${roadLabelX}" y="${roadLabelY}" text-anchor="middle" fill="#38BDF8" font-family="Arial, sans-serif" font-size="12" font-weight="bold" letter-spacing="1">▲ ${plot.facing.toUpperCase()} FRONTAGE ROAD ACCESS (${plot.roadWidth} FT ROW) ▲</text>

  <!-- Bottom Verification Legend -->
  <rect x="36" y="925" width="${svgW - 72}" height="135" rx="8" fill="#0B1526" stroke="#DAA520" stroke-opacity="0.55" stroke-width="1.5"/>
  <text x="56" y="954" fill="#DAA520" font-family="Arial, sans-serif" font-size="12.5" font-weight="bold" letter-spacing="0.8">1:1 GEOMETRIC SYNCHRONIZATION WITH 2D FLOOR PLAN</text>
  <text x="56" y="978" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="11.5">• Every room block, wall partition, furniture volume, and dimension in this 3D cutaway is extruded directly from the canonical 2D coordinates.</text>
  <text x="56" y="1000" fill="#E2E8F0" font-family="Arial, sans-serif" font-size="11.5">• Plot Area: ${areas.plotAreaSqFt.toLocaleString()} sq.ft (${plot.widthFt}' × ${plot.depthFt}')  |  Buildable Envelope: ${areas.buildingEnvelopeSqFt.toLocaleString()} sq.ft (${envelope.widthFt}' × ${envelope.depthFt}')  |  Total Built-Up: ${areas.totalBuiltUpAreaSqFt.toLocaleString()} sq.ft</text>
  <text x="56" y="1022" fill="#94A3B8" font-family="Arial, sans-serif" font-size="11">• Setbacks: Front ${setbacks.frontFt}ft, Rear ${setbacks.rearFt}ft, Left ${setbacks.leftFt}ft, Right ${setbacks.rightFt}ft (${escXml(setbacks.source)}).</text>
  <text x="56" y="1044" fill="#64748B" font-family="Arial, sans-serif" font-size="10">Note: Isometric 3D cutaway preview image (SVG/PNG). Conceptual visualization only — not a licensed structural or municipal compliance submission.</text>
</svg>`;
}

/**
 * Generates a structured, coherent Executive Summary without raw Markdown asterisks
 * or unsupported compliance/zoning/structural claims.
 */
function buildCoherentSummary(model) {
  const { plot, setbacks, envelope, areas, rooms, program } = model;
  const roomLines = rooms
    .map(
      (r) =>
        `• ${r.code} ${r.name}: ${r.width} ft × ${r.depth} ft = ${r.areaSqFt} sq.ft (${r.zone})`
    )
    .join('\n');

  return [
    `PROJECT OVERVIEW & CANONICAL GEOMETRY`,
    `This ${program.bedrooms} BHK (${program.stories === 1 ? 'Ground Floor' : `G+${program.stories - 1}`}) residential layout has been synthesized from a single deterministic geometric model for a ${plot.rawWidth} × ${plot.rawDepth} ${plot.displayUnit} (${plot.facing.toUpperCase()}-facing) plot with a ${plot.roadWidth} ft frontage road. The 2D floor plan, 3D isometric cutaway preview, and room schedule below all derive from the exact same room coordinates and dimensions.`,
    ``,
    `AREA RECONCILIATION (PLOT VS. ENVELOPE VS. BUILT-UP AREA)`,
    `• Gross Plot Area: ${plot.widthFt} ft × ${plot.depthFt} ft = ${areas.plotAreaSqFt.toLocaleString()} sq.ft`,
    `• Peripheral Setbacks (${setbacks.source}): Front ${setbacks.frontFt} ft, Rear ${setbacks.rearFt} ft, Left ${setbacks.leftFt} ft, Right ${setbacks.rightFt} ft`,
    `• Setback-Constrained Buildable Envelope: ${envelope.widthFt} ft × ${envelope.depthFt} ft = ${areas.buildingEnvelopeSqFt.toLocaleString()} sq.ft`,
    `• Ground Floor Enclosed Area: ${areas.groundFloorEnclosedSqFt.toLocaleString()} sq.ft`,
    `• Ground Floor Semi-Open Area (Foyer / Portico): ${areas.groundFloorSemiOpenSqFt.toLocaleString()} sq.ft`,
    `• Ground Floor Footprint: ${areas.groundFloorFootprintSqFt.toLocaleString()} sq.ft (${areas.groundCoveragePct}% plot coverage)`,
    ...(program.stories > 1
      ? [
          `• Upper Floor(s) Built-Up Area (${program.stories - 1} Upper Level${program.stories > 2 ? 's' : ''}): ${areas.upperFloorsBuiltUpSqFt.toLocaleString()} sq.ft`,
        ]
      : []),
    `• Total Built-Up Area (${program.stories} Floor${program.stories > 1 ? 's' : ''}): ${areas.totalBuiltUpAreaSqFt.toLocaleString()} sq.ft`,
    `• Unobstructed Open Setback Area: ${areas.setbackOpenAreaSqFt.toLocaleString()} sq.ft`,
    ``,
    `GROUND FLOOR ROOM SCHEDULE & COORDINATE ALLOCATION`,
    roomLines,
    ``,
    `CIRCULATION, ORIENTATION & DESIGN DIRECTIVES`,
    `• Primary Ingress: ${plot.facing.toUpperCase()} road frontage leading into the Entrance Foyer and Formal Living Lounge.`,
    `• Culinary & Wet Core: ${program.kitchenType.toUpperCase()} kitchen placed in the South-East zone adjacent to the ${program.diningStyle === 'none' ? 'Central Circulation Hall' : 'Dining Hall'}, keeping wet plumbing risers consolidated.`,
    `• Vastu Orientation: ${program.vastuEnabled ? `Enabled (${program.vastuStrictness} mode) — Master Suite anchored in the Rear-West (SW) quadrant and Kitchen in the South-East quadrant.` : 'Standard bioclimatic daylighting and cross-ventilation orientation.'}`,
    `• Architectural Typology: ${program.archStyle.toUpperCase()} aesthetic with ${program.finish.toUpperCase()} finish specification.`,
    ...(program.specialNotes ? [`• Special Directives Applied: ${program.specialNotes}`] : []),
    ...(program.avoidNotes ? [`• Exclusions Respected: ${program.avoidNotes}`] : []),
    ``,
    `IMPORTANT ARCHITECTURAL DISCLOSURE`,
    `This output is a conceptual architectural layout and 3D cutaway preview generated from your spatial inputs. Setbacks (${setbacks.source.toLowerCase()}) and room proportions are for preliminary planning only and do not constitute municipal zoning approval, building code certification, or a licensed structural engineering design.`,
  ].join('\n');
}

/**
 * POST /api/blueprint/generate
 * Validates the user's residential brief and returns a coherent 2D Floor Plan,
 * 3D Isometric Cutaway Preview, Canonical Layout Model, and Executive Summary.
 */
router.post('/generate', async (req, res) => {
  try {
    const { jsonData, mode = 'both' } = req.body || {};
    const canonicalModel = buildCanonicalLayout(jsonData);

    const svg2D = render2DFloorPlanSvg(canonicalModel);
    const svg3D = render3DCutawaySvg(canonicalModel);

    // Persist generated SVG files under /uploads/posts so both direct URL downloads
    // and data URI rendering work seamlessly across Web and Android APK.
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'posts');
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (_) {}

    const stamp = `${canonicalModel.plot.rawWidth}x${canonicalModel.plot.rawDepth}_${ canonicalModel.program.bedrooms }bhk_${Date.now()}`;
    const file2d = `blueprint_2d_${stamp}.svg`;
    const file3d = `blueprint_3d_${stamp}.svg`;

    try {
      fs.writeFileSync(path.join(uploadsDir, file2d), svg2D, 'utf8');
      fs.writeFileSync(path.join(uploadsDir, file3d), svg3D, 'utf8');
    } catch (writeErr) {
      console.warn('[blueprint] Could not write SVG file to disk, using data URI only:', writeErr.message);
    }

    const dataUri2D = `data:image/svg+xml;utf8,${encodeURIComponent(svg2D)}`;
    const dataUri3D = `data:image/svg+xml;utf8,${encodeURIComponent(svg3D)}`;

    const summary = buildCoherentSummary(canonicalModel);

    return res.status(200).json({
      success: true,
      mode,
      plan2dUrl: mode === '3d' ? null : dataUri2D,
      plan3dUrl: mode === '2d' ? null : dataUri3D,
      plan2dSvg: mode === '3d' ? null : svg2D,
      plan3dSvg: mode === '2d' ? null : svg3D,
      plan2dFileUrl: `/uploads/posts/${file2d}`,
      plan3dFileUrl: `/uploads/posts/${file3d}`,
      summary,
      canonicalLayout: canonicalModel,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Unable to generate house plan layout.',
    });
  }
});

module.exports = router;
