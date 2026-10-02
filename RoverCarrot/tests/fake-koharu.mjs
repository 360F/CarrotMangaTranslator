// Internal API fixture only: raw tensors pass through the production parser,
// geometry, subdivision, block mapping and persistence.
export function rawOutputs() {
  const dets = new Float32Array(300 * 4);
  const labels = new Float32Array(300 * 5).fill(-20);
  const plane = 288 * 288;
  const masks = new Float32Array(300 * plane).fill(-20);
  const proposals = [
    { label: 0, box: [.25, .4, .25, .6], bands: [[45, 55], [70, 80]], y: [35, 195] },
    { label: 1, box: [.8, .8, .15, .15], bands: [[210, 235]], y: [215, 240] },
    { label: 2, box: [.25, .4, .35, .7], bands: [[25, 110]], y: [20, 220] },
    { label: 3, box: [.5, .5, 1, 1], bands: [[0, 288]], y: [0, 288] },
  ];
  proposals.forEach((proposal, i) => {
    dets.set(proposal.box, i * 4); labels[i * 5 + proposal.label] = 4 - i * .1;
    for (const [x1,x2] of proposal.bands) for (let y=proposal.y[0]; y<proposal.y[1]; y++)
      masks.fill(4, i * plane + y * 288 + x1, i * plane + y * 288 + x2);
  });
  return { dets: { data: dets, dims: [1,300,4], type: 'float32' }, labels: { data: labels, dims: [1,300,5], type: 'float32' },
    masks: { data: masks, dims: [1,300,288,288], type: 'float32' } };
}
let outputs;
export const fakeRuntime = { async infer(image) {
  if (image.dims.join(',') !== '1,3,1152,1152' || image.data.length !== 3 * 1152 * 1152) throw new Error('Input contract violated');
  return outputs ??= rawOutputs();
} };
