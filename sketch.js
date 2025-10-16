import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0';

env.allowLocalModels = false;

// These variables are defined outside the sketch so the AI models can be loaded first.
let classifier = null;
let encoder = null;

// The main sketch function. All p5 logic is now wrapped inside this.
// It takes one argument, `p`, which is the p5 instance.
const sketch = (p) => {
    let trailLayer;
    let bicycle;
    let noiseTime = 0;
    let totalMovement = 0;
    let gameState = 'SEEDING';
    let particles = [];
    let stars = [];
    let ideaTrajectory = [];
    let colorPalette = [];
    let hoveredIdea = null;
    const MAX_PALETTE_SIZE = 4;

    p.setup = () => {
        p.colorMode(p.HSB, 360, 100, 100, 1);
        p.createCanvas(p.windowWidth, p.windowHeight).parent('canvas-container');
        trailLayer = p.createGraphics(p.windowWidth, p.windowHeight);
        trailLayer.colorMode(p.HSB, 360, 100, 100, 1);
        bicycle = null;

        const ideaInput = document.getElementById('idea-input');
        ideaInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const inputText = ideaInput.value;
                if (inputText.trim() === '') return;
                handleInput(inputText);
                ideaInput.value = '';
            }
        });

        const saveButton = p.select('#save-button');
        saveButton.mousePressed(saveArt);

        for (let i = 0; i < 500; i++) {
            stars.push({
                x: p.random(p.width),
                y: p.random(p.height),
                size: p.random(1, 3),
                alpha: p.random(100, 255)
            });
        }
        document.getElementById('idea-input').placeholder = "Plant the seed of an idea...";
    };

    p.draw = () => {
        // 1. Draw the background
        p.background(240, 50, 8);
        drawStarfield();
        p.image(trailLayer, 0, 0);
        trailLayer.filter(p.BLUR, 0.5);

        // 2. Draw the in-world elements
        drawIdeaNodes();
        p.noStroke();
        if (colorPalette.length > 0) {
            trailLayer.noStroke();
            for (let i = particles.length - 1; i >= 0; i--) {
                let particle = particles[i];
                particle.px = particle.x;
                particle.py = particle.y;
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.lifespan -= 2;
            
                if (particle.lifespan <= 0) {
                    particles.splice(i, 1);
                } else {
                    const c = particle.color;
                    const alpha = particle.lifespan / 255;
            
                    if (particle.type === 'streak') {
                        // Draw the live streak
                        p.strokeWeight(particle.weight);
                        p.stroke(p.hue(c), p.saturation(c), p.brightness(c), alpha * 0.5);
                        p.line(particle.px, particle.py, particle.x, particle.y);
                        
                        // Stamp a very faint permanent mark
                        trailLayer.strokeWeight(particle.weight * 0.8);
                        trailLayer.stroke(p.hue(c), p.saturation(c), p.brightness(c), 0.02);
                        trailLayer.line(particle.px, particle.py, particle.x, particle.y);
            
                    } else { // 'dust'
                        // Draw the live dust mote
                        p.noStroke();
                        p.fill(p.hue(c), p.saturation(c), p.brightness(c), alpha * 0.4);
                        p.ellipse(particle.x, particle.y, particle.size);
            
                        // Stamp a faint permanent glow
                        trailLayer.noStroke();
                        trailLayer.fill(p.hue(c), p.saturation(c), p.brightness(c), 0.15);
                        trailLayer.ellipse(particle.x, particle.y, particle.size * 3);
                    }
                }
            }            
        }

        // 3. Draw the bicycle
        if (!bicycle) return;
        const ideaInput = document.getElementById('idea-input');
        if (bicycle.isDropping) {
            bicycle.yVelocity += bicycle.gravity;
            bicycle.y += bicycle.yVelocity;
            if (bicycle.y >= bicycle.groundY) {
                bicycle.y = bicycle.groundY;
                bicycle.yVelocity *= -0.6;
                if (p.abs(bicycle.yVelocity) < 1) {
                    bicycle.isDropping = false;
                    ideaInput.disabled = false;
                    ideaInput.focus();
                }
            }
        } else if (bicycle.targetX !== null) {
            totalMovement += bicycle.speed;
            bicycle.px = bicycle.x;
            bicycle.py = bicycle.y;
            bicycle.x = p.lerp(bicycle.x, bicycle.targetX, 0.03);
            bicycle.y = p.lerp(bicycle.y, bicycle.targetY, 0.03);
            const angleToTarget = p.atan2(bicycle.targetY - bicycle.y, bicycle.targetX - bicycle.x);
            bicycle.angle = lerpAngle(bicycle.angle, angleToTarget, 0.1);
            bicycle.speed = p.dist(bicycle.x, bicycle.y, bicycle.px, bicycle.py);
            bicycle.wheelRotation += bicycle.speed * 0.1;
            emitParticles();
            if (p.dist(bicycle.x, bicycle.y, bicycle.targetX, bicycle.targetY) < 2) {
                if (bicycle.pendingIdeaText && bicycle.arrivalPoint) {
                    ideaTrajectory.push({ 
                        text: bicycle.pendingIdeaText, 
                        x: bicycle.arrivalPoint.x, 
                        y: bicycle.arrivalPoint.y,
                        distance: bicycle.pendingJumpDistance
                    });
                    bicycle.pendingIdeaText = null;
                    bicycle.arrivalPoint = null;
                    bicycle.pendingJumpDistance = null;
                }
                bicycle.targetX = null;
                bicycle.targetY = null;
                bicycle.speed = 0;
                ideaInput.disabled = false;
                ideaInput.focus();
            }
        }
        drawBicycle();

        // 4. Draw the tooltip
        drawTooltip();

        // 5. Draw the UI
        drawUI();

        // 6. Update the noise time
        noiseTime += 0.005;
    };

    // --- All Helper Functions are now inside the main sketch function ---

    async function handleInput(inputText) {
        const ideaInput = document.getElementById('idea-input');
        ideaInput.disabled = true;
        try {
            console.log("Analyzing text with in-browser AI...");
            const candidate_labels = ["constructive argument", "critical challenge", "question"];
            const intent_result = await classifier(inputText, candidate_labels);
            const intent = intent_result.labels[0];
            const embedding = await encoder(inputText, { pooling: 'mean', normalize: true });
            const vector = embedding.data;
            const analysis = { intent, vector };
            console.log("Analysis complete:", analysis);
            if (gameState === 'SEEDING') {
                spawnBicycle(analysis.vector);
                ideaTrajectory.push({ text: inputText, x: bicycle.x, y: bicycle.groundY, distance: 0 });
                gameState = 'DEVELOPING';
                ideaInput.placeholder = "Move the bicycle...";
            } else if (gameState === 'DEVELOPING') {
                const newVector = analysis.vector;
                const dx = newVector[5] - bicycle.currentVector[5];
                const dy = newVector[8] - bicycle.currentVector[8];
                const moveScale = 750;
                bicycle.targetX = bicycle.x + dx * moveScale;
                bicycle.targetY = bicycle.y + dy * moveScale;
                const jumpDistance = p.dist(bicycle.x, bicycle.y, bicycle.targetX, bicycle.targetY);
                bicycle.pendingIdeaText = inputText;
                bicycle.pendingJumpDistance = jumpDistance;
                bicycle.arrivalPoint = { x: bicycle.targetX, y: bicycle.targetY };
                const hueValue = getVectorSliceAverage(newVector, 0, 128);
                let baseHue;
                if (hueValue >= 0) {
                    baseHue = p.map(p.pow(hueValue, 3), 0, p.pow(0.1, 3), 60, 330);
                } else {
                    baseHue = p.map(p.pow(hueValue, 3), -p.pow(0.1, 3), 0, 240, 60);
                }
                const saturation = p.random(70, 100);
                const brightness = p.random(90, 100);
                const newColor = p.color(basehue, saturation, brightness);
                colorPalette.unshift(newColor);
                if (colorPalette.length > MAX_PALETTE_SIZE) { colorPalette.pop(); }
                bicycle.currentVector = newVector;
            }
        } catch (error) {
            console.error("Error during analysis:", error);
            ideaInput.disabled = false;
        }
    }

    function spawnBicycle(initialVector) {
        const randomX = p.random(p.width * 0.2, p.width * 0.8);
        const randomY = p.random(p.height * 0.2, p.height * 0.8);
        bicycle = {
            groundY: randomY, x: randomX, y: randomY - 200, py: randomY - 200, yVelocity: 0, gravity: 0.5, isDropping: true,
            angle: 0, targetX: null, targetY: null, speed: 0, wheelRotation: 0,
            wheelRadius: 15, wheelBase: 25, currentVector: initialVector,
            pendingIdeaText: null, arrivalPoint: null
        };
        const hueValue = getVectorSliceAverage(initialVector, 0, 128);
        let baseHue;
        if (hueValue >= 0) {
            baseHue = p.map(p.pow(hueValue, 3), 0, p.pow(0.1, 3), 60, 330);
        } else {
            baseHue = p.map(p.pow(hueValue, 3), -p.pow(0.1, 3), 0, 240, 60);
        }
        const saturation = p.random(70, 100);
        const brightness = p.random(90, 100);
        const initialColor = p.color(baseHue, saturation, brightness);    
        colorPalette = [initialColor];
    }

    function drawBicycle() {
        p.push();
        p.translate(bicycle.x, bicycle.y);
        p.rotate(bicycle.angle);
        p.stroke(255);
        p.strokeWeight(4);
        p.noFill();
        const wheelRadius = bicycle.wheelRadius;
        const wheelBase = bicycle.wheelBase;
        p.circle(-wheelBase, 0, wheelRadius * 2);
        p.circle(wheelBase, 0, wheelRadius * 2);
        p.line(-wheelBase, 0, -wheelBase + p.cos(bicycle.wheelRotation) * wheelRadius, p.sin(bicycle.wheelRotation) * wheelRadius);
        p.line(wheelBase, 0, wheelBase + p.cos(bicycle.wheelRotation) * wheelRadius, p.sin(bicycle.wheelRotation) * wheelRadius);
        const seatHeight = -25;
        const handleHeight = -35;
        p.line(-wheelBase, 0, -5, seatHeight);
        p.line(wheelBase, 0, -5, seatHeight);
        p.line(0, seatHeight, -10, seatHeight);
        p.line(wheelBase, 0, wheelBase - 5, handleHeight);
        p.line(wheelBase - 15, handleHeight, wheelBase + 5, handleHeight);
        p.pop();
    }

    function emitParticles() {
        if (bicycle.speed < 0.1) return;
        const backWheelX = bicycle.x - bicycle.wheelBase * p.cos(bicycle.angle);
        const backWheelY = bicycle.y - bicycle.wheelBase * p.sin(bicycle.angle);
        for (let i = 0; i < 4; i++) {
            // A particle from the back wheel
            createParticle(backWheelX, backWheelY);
        }
    }

    function createParticle(x, y) {
        // Get the base hue from the most recent color in the palette.
        const baseHue = p.hue(colorPalette[0]);
    
        const particle = {
            x: x, y: y,
            px: x, py: y,
            color: getMixedColor(baseHue), // Pass the base hue to get a variation
            lifespan: 255
        };
    
        // --- THE DYNAMIC BRUSH ENGINE ---
        // Use a different slice of the vector to control the "energy" of the brush.
        const energyValue = getVectorSliceAverage(bicycle.currentVector, 128, 256);
        const energy = p.map(energyValue, -0.1, 0.1, 0, 1);
    
        if (p.random(1) < 0.8) { // 80% chance for a Streak
            particle.type = 'streak';
            const angle = p.random(p.TWO_PI);
            // The speed (and length) of the streak is now tied to the idea's "energy"
            const speed = p.map(energy, 0, 1, 1.0, 5.0) + p.random(-0.5, 0.5);
            particle.vx = p.cos(angle) * speed;
            particle.vy = p.sin(angle) * speed;
            particle.weight = p.random(0.5, 2);
            particle.lifespan = p.random(100, 200);
        } else {
            particle.type = 'dust';
            particle.vx = p.random(-0.3, 0.3);
            particle.vy = p.random(-0.3, 0.3);
            particle.size = p.random(2, 6);
            particle.lifespan = p.random(80, 150);
        }
    
        particles.push(particle);
    }    

    function drawStarfield() {
        p.noStroke();
        for (const star of stars) {
            p.fill(255, star.alpha);
            p.ellipse(star.x, star.y, star.size);
        }
    }

    function saveArt() {
        p.background(240, 50, 8);
        drawStarfield();
        p.image(trailLayer, 0, 0);
        trailLayer.filter(p.BLUR, 0.5);
        drawIdeaNodes();
        drawUI();
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        p.saveCanvas(`bicycle-for-the-mind-${timestamp}`, 'png');
        const formattedTrajectory = ideaTrajectory.map((idea, index) => {
            if (index === 0) {
                return `1. (Seed) - ${idea.text}`;
            }
            // Scale the distance to match the on-screen display
            const jumpDist = (idea.distance / 100).toFixed(2);
            return `${index + 1}. (+${jumpDist}m) - ${idea.text}`;
        });
        const totalDist = (totalMovement / 100).toFixed(2);
        formattedTrajectory.unshift(`BICYCLE FOR THE MIND\nTotal Movement: ${totalDist}m\n---`);
        
        p.saveStrings(formattedTrajectory, `idea-trajectory_${timestamp}`, 'txt');    
    }

    function lerpAngle(startAngle, endAngle, amount) {
        let difference = endAngle - startAngle;
        if (difference > p.PI) { difference -= p.TWO_PI; }
        else if (difference < -p.PI) { difference += p.TWO_PI; }
        return startAngle + difference * amount;
    }

    function getMixedColor(baseHue) {
        if (colorPalette.length === 0) { return p.color(0, 0, 100); } // White in HSB
        const hue = baseHue + p.random(-30, 30); // Add a random shift to the base hue
        const saturation = p.random(70, 100);
        const brightness = p.random(90, 100);
        return p.color(hue, saturation, brightness);
    }    

    function drawIdeaNodes() {
        const hoverRadius = 10;
        hoveredIdea = null; // Reset the hovered idea at the start of every frame
    
        for (const idea of ideaTrajectory) {
            const distance = p.dist(p.mouseX, p.mouseY, idea.x, idea.y);
            let nodeAlpha = 120;
    
            // If we are hovering, set the alpha and update our global variable
            if (distance < hoverRadius) {
                nodeAlpha = 255;
                hoveredIdea = idea; // Set the currently hovered idea
            }
    
            p.fill(60, 100, 100, nodeAlpha);
            p.noStroke();
            p.ellipse(idea.x, idea.y, hoverRadius);
        }
    }
    function drawTooltip() {
        // If no idea is being hovered, do nothing.
        if (!hoveredIdea) {
            return;
        }
    
        // If we are hovering, draw the tooltip for the stored hoveredIdea.
        const textBoxWidth = 200;
        const textPadding = 10;
        const boxX = hoveredIdea.x + 15;
        const boxY = hoveredIdea.y - 20;
    
        p.fill(0, 0, 0, 180);
        p.stroke(255, 150);
        p.strokeWeight(1);
        p.rect(boxX, boxY, textBoxWidth + textPadding * 2, 80, 5);
    
        p.noStroke();
        p.fill(255);
        p.textSize(12);
        p.textAlign(p.LEFT, p.TOP);
        p.text(hoveredIdea.text, boxX + textPadding, boxY + textPadding, textBoxWidth);
    }

    function drawUI() {
        // We'll scale the raw pixel distance down to make the numbers feel more meaningful
        const displayMiles = (totalMovement / 100).toFixed(2);
    
        p.fill(255, 200); // Faint white
        p.noStroke();
        p.textSize(14);
        p.textAlign(p.LEFT, p.TOP);
        p.textFont('sans-serif');
        
        // Draw the text in the top-left corner
        p.text(`Total Movement: ${displayMiles}m`, 20, 20);
    }

    function getVectorSliceAverage(vector, start, end) {
        if (!vector) return 0;
        let sum = 0;
        for (let i = start; i < end; i++) {
            sum += vector[i];
        }
        return sum / (end - start);
    }    
}; // --- END OF THE MAIN SKETCH FUNCTION ---

// This main function runs once. It loads the AI models and then starts the p5 sketch.
async function main() {
    console.log("Constructing the Bicycle for the Mind...");
    classifier = await pipeline('zero-shot-classification', 'Xenova/bart-large-mnli');
    encoder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    document.getElementById('loading-overlay').style.display = 'none';
    
    // Create the p5 instance and attach it to the container div
    new p5(sketch, 'canvas-container');
}

// Start the whole process
main();