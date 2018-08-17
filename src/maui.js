const fs = require("fs");
const PNG = require("pngjs").PNG;

const LOWEST_HABITABLE_TEMP = 273.15 - 15.5;
const HIGHEST_HABITABLE_TEMP = 273.15 + 34.4;
const SAMPLE_RATE = 200;
const ALTITUDE_TEMP_DECREASE = 1.5 / 0.3 / 20000;

function distance(coordsA, coordsB) {
    let radicand = 0;
    for (let i = 0; i < coordsA.length; i++) {
        radicand += Math.pow(coordsA[i] - coordsB[i], 2);
    }
    return Math.sqrt(radicand);
}

function drawCircle(grid, x, y, size, f) {
    radius = size / 2;
    for (let row = y; row <= y + size; row++) {
        for (let col = x; col <= x + size; col++) {
            if (row < grid.length && row >= 0 &&
                col < grid[row].length && col >= 0 &&
                distance([col, row], [x + radius, y + radius]) <= radius) {
                grid[row][col] = f(grid[row][col]);
            }
        }
    }
}

function pushUp(height) {
    return height + 1;
}

function pushDown(height) {
    return height - 1;
}

function blankMap(size) {
    let outArr = [];
    for (let i = 0; i < size; i++) {
        let row = [];
        for (let j = 0; j < size; j++) {
            row.push(0);
        }
        outArr.push(row);
    }
    return outArr;
}

function stamp(heightmap) {
    let size = Math.ceil(Math.random() * 64);
    let x = Math.floor(Math.random() * (heightmap[0].length + size)) - size;
    let y = Math.floor(Math.random() * (heightmap.length + size)) - size;
    drawCircle(heightmap, x, y, size, Math.random() >= 0.5 ? pushUp : pushDown);
}

function bestInGrid(grid, betterThan) {
    let best = grid[0][0];
    for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[0].length; col++) {
            if (betterThan(grid[row][col], best)) {
                best = grid[row][col];
            }
        }
    }
    return best;
}

function lowestPoint(grid) {
    return bestInGrid(grid, (x, y) => x < y);
}

function highestPoint(grid) {
    return bestInGrid(grid, (x, y) => x > y);
}

function rangeOf(grid) {
    return highestPoint(grid) - lowestPoint(grid);
}

function redistribute(grid, targetRange) {
    let offset = - lowestPoint(grid);
    let multiplier = (targetRange - 1) / rangeOf(grid);
    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[0].length; j++) {
            grid[i][j] = Math.floor((grid[i][j] + offset) * multiplier);
        }
    }
}

function makeNoise(size, stamps = 50000, target = 256) {
    let heightmap = blankMap(size);
    for (let s = 0; s < stamps; s++) {
        stamp(heightmap);
    }
    redistribute(heightmap, target);
    return heightmap;
}

function gridToImgData(grid, redFun = x => x, blueFun = x => x,
        greenFun = x => x, alphaFun = x => 255) {
    let outArr = [];
    for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[0].length; col++) {
            outArr.push(redFun(grid[row][col]));
            outArr.push(blueFun(grid[row][col]));
            outArr.push(greenFun(grid[row][col]));
            outArr.push(alphaFun(grid[row][col]));
        }
    }
    return outArr;
}

function heatmapToImgData(heatmap) {
    let rate = findHeatRate(heatmap);
    return gridToImgData(
        heatmap,
        x => x * rate > HIGHEST_HABITABLE_TEMP ? 255 : 0,
        x => isHabitableHeat(x * rate) ? 255 : 0,
        x => x * rate < LOWEST_HABITABLE_TEMP ? 255 : 0);
}

function rayAngle([x1, y1, z1], [x2, y2, z2]) {
    let horizontal = distance([x1, y1], [x2, y2]);
    let vertical = z2 - z1;
    return Math.atan(vertical / horizontal);
}

// altitude is in kilometers
function calcTemp(east, south, altitude, size, times = 200) {
    let center = size / 2;
    let radius = size / 4;
    let total = 0;
    for (let time = 0; time <= times; time++) {
        let angle = (time / times) * Math.PI;
        let coords = [
            center + (radius * Math.cos(angle)),
            center,
            radius * Math.sin(angle)];
        let dist = distance([east, south, altitude], coords);
        if (dist == 0) {dist++;}
        let radiation = 1 / Math.pow(dist, 2);
        total += radiation *
            Math.cos(rayAngle([east, south, altitude], coords));
    }
    return total - ALTITUDE_TEMP_DECREASE * altitude;
}

function makeHeatmap(heightmap, zScale = 0.01) {
    let outGrid = [];
    for (let south = 0; south < heightmap.length; south++) {
        let outRow = []
        for (let east = 0; east < heightmap[0].length; east++) {
            outRow.push(calcTemp(
                east, south, heightmap[south][east] * zScale, heightmap.length));
        }
        outGrid.push(outRow);
    }
    return outGrid;
}

function isHabitableHeat(kelvin) {
    return kelvin >= LOWEST_HABITABLE_TEMP && kelvin <= HIGHEST_HABITABLE_TEMP;
}

function randomTest(grid, minX, maxX, minY, maxY, test) {
    let rangeX = maxX - minX;
    let rangeY = maxY - minY;
    let success = 0;
    let failure = 0;
    for (let i = 0; i < SAMPLE_RATE; i++) {
        x = Math.floor(Math.random() * rangeX) + minX;
        y = Math.floor(Math.random() * rangeY) + minY;
        if (test(grid[y][x])) {
            success++;
        } else {
            failure++;
        }
    }
    return success / (success + failure)
}

function normalRangeHabitability(heatmap, rate) {
    let minimum = heatmap.length * 7 / 16;
    let maximum = heatmap.length * 9 / 16;
    return randomTest(heatmap, minimum, maximum, minimum, maximum,
        x => isHabitableHeat(x * rate))
}

function maximize(f, minimum, maximum, ...args) {
    let range = maximum - minimum;
    let pairs = [];
    for (let i = 0; i < 600; i++) {
        let input = minimum + Math.random() * range;
        pairs.push([input, f(...args, input)]);
    }
    console.log(pairs.reduce((a, b) => a[1] > b[1] ? a : b));
    return pairs.reduce((a, b) => a[1] > b[1] ? a : b)[0];
}

function findHeatRate(heatmap) {
    return maximize(
        normalRangeHabitability,
        0,
        1000000,
        heatmap);
}

let size = 1024;
console.log("Generating heightmap...");
let heights = makeNoise(size);

console.log("Creating heightmap image...");
let outImg = new PNG({width: size, height: size});
outImg.data = gridToImgData(heights);
console.log("Saving heightmap image...");
outImg.pack()
  .pipe(fs.createWriteStream(__dirname + '/heightmap.png'))
  .on('finish', function() {
    console.log('Heightmap image written!');
});

console.log("Calculating heatmap...");
let heats = makeHeatmap(heights);
let heatImg = new PNG({width: size, height: size});
heatImg.data = heatmapToImgData(heats);
heatImg.pack()
  .pipe(fs.createWriteStream(__dirname + '/heatmap.png'))
  .on('finish', function() {
    console.log('Heatmap image written!');
});