export async function async_map(values, callback) {
  const result = [];
  for (let index = 0; index < values.length; index++) result.push(await callback(values[index], index, values));
  return result;
}
export async function async_filter(values, callback) {
  const result = [];
  for (let index = 0; index < values.length; index++) if (await callback(values[index], index, values)) result.push(values[index]);
  return result;
}
export async function async_find(values, callback) {
  for (let index = 0; index < values.length; index++) if (await callback(values[index], index, values)) return values[index];
}
export async function async_some(values, callback) {
  for (let index = 0; index < values.length; index++) if (await callback(values[index], index, values)) return true;
  return false;
}
export async function async_every(values, callback) {
  for (let index = 0; index < values.length; index++) if (!(await callback(values[index], index, values))) return false;
  return true;
}
export async function async_forEach(values, callback) {
  for (let index = 0; index < values.length; index++) await callback(values[index], index, values);
}
export async function async_flatMap(values, callback) {
  return (await async_map(values, callback)).flat();
}
