import { distanceMeters } from './geo.ts';

// BART station codes, which bart.gov uses for each station page (bart.gov/stations/mont), with
// each station's location. 511 numbers BART stations its own way, so a station is matched to
// its code by place. From BART's station list (api.bart.gov, cmd=stns), 50 stations.
const BART_STATIONS: [code: string, lat: number, lon: number][] = [
  ["12th", 37.80377, -122.27145],
  ["16th", 37.76506, -122.41969],
  ["19th", 37.80835, -122.26860],
  ["24th", 37.75247, -122.41814],
  ["antc", 37.99539, -121.78042],
  ["ashb", 37.85280, -122.27006],
  ["balb", 37.72158, -122.44751],
  ["bayf", 37.69692, -122.12651],
  ["bery", 37.36847, -121.87468],
  ["cast", 37.69075, -122.07560],
  ["civc", 37.77973, -122.41412],
  ["cols", 37.75366, -122.19687],
  ["colm", 37.68464, -122.46623],
  ["conc", 37.97374, -122.02909],
  ["daly", 37.70612, -122.46908],
  ["dbrk", 37.87010, -122.26813],
  ["dubl", 37.70169, -121.89918],
  ["deln", 37.92509, -122.31679],
  ["plza", 37.90263, -122.29890],
  ["embr", 37.79287, -122.39702],
  ["frmt", 37.55747, -121.97661],
  ["ftvl", 37.77484, -122.22418],
  ["glen", 37.73306, -122.43382],
  ["hayw", 37.66972, -122.08702],
  ["lafy", 37.89318, -122.12463],
  ["lake", 37.79703, -122.26518],
  ["mcar", 37.82906, -122.26704],
  ["mlbr", 37.60027, -122.38670],
  ["mlpt", 37.41028, -121.89108],
  ["mont", 37.78941, -122.40107],
  ["nbrk", 37.87397, -122.28344],
  ["ncon", 38.00319, -122.02465],
  ["oakl", 37.71324, -122.21219],
  ["orin", 37.87836, -122.18379],
  ["pctr", 38.01694, -121.88946],
  ["pitt", 38.01891, -121.94515],
  ["phil", 37.92847, -122.05601],
  ["powl", 37.78447, -122.40797],
  ["rich", 37.93685, -122.35310],
  ["rock", 37.84470, -122.25137],
  ["sbrn", 37.63776, -122.41629],
  ["sfia", 37.61597, -122.39241],
  ["sanl", 37.72195, -122.16084],
  ["shay", 37.63437, -122.05719],
  ["ssan", 37.66425, -122.44396],
  ["ucty", 37.59063, -122.01739],
  ["wcrk", 37.90552, -122.06753],
  ["warm", 37.50217, -121.93931],
  ["wdub", 37.69976, -121.92824],
  ["woak", 37.80487, -122.29514],
];

// A BART station's code, from the nearest station within a short walk of the given place.
export function bartStationCode(place: { lat: number; lon: number }) {
  let best: { code: string; meters: number } | null = null;
  for (const [code, lat, lon] of BART_STATIONS) {
    const meters = distanceMeters(place, { lat, lon });
    if (meters <= 300 && (!best || meters < best.meters)) best = { code, meters };
  }
  return best?.code ?? null;
}
