async function test() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/TungTh/tungth.github.io/master/data/vn-provinces.json');
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    console.log(data.features.length + ' provinces found');
    console.log(data.features[0].properties);
  } catch(e) {
    console.error(e);
  }
}
test();
