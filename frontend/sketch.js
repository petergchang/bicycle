let trailLayer;
let bicycle;
let gameState = 'SEEDING'; // Our new state machine!
let particles = [];
let stars = [];
let ideaTrajectory = [];
let colorPalette = [];
const MAX_PALETTE_SIZE = 4; // How many recent idea-colors to remember
let classifier = null;
let encoder = null;
let modelsReady = false; // A flag to track if the AI is ready



async function setup() {
    createCanvas(windowWidth, windowHeight);    
    classifier = await pipeline('zero-shot-classification', 'Xenova/bart-large-mnli');
    encoder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  
    // Once loaded, hide the loading screen and set our flag
    document.getElementById('loading-overlay').style.display = 'none';
    modelsReady = true;
    console.log("AI models loaded successfully in the browser!");


    background(10, 10, 20);  
  
    // Initialize the permanent art layer
    trailLayer = createGraphics(windowWidth, windowHeight);
  
    // The bicycle starts as null until the first idea is planted
    bicycle = null; 
  
    // --- THIS IS THE FIX ---
    // We must re-establish the event listener for the text input.
    const ideaInput = document.getElementById('idea-input');
    ideaInput.addEventListener('keydown', function(e) {
      // Check if the key pressed is 'Enter' AND the Shift key is NOT held down
      if (e.key === 'Enter' && !e.shiftKey) {
        // This is the magic line that PREVENTS the new paragraph from being created.
        e.preventDefault(); 
        
        const inputText = ideaInput.value;
        if (inputText.trim() === '') return;
        
        handleInput(inputText);
        ideaInput.value = '';
      }
    });
    // --- END OF FIX ---
  
    // Set up the save button
    const saveButton = select('#save-button');
    saveButton.mousePressed(saveArt);
  
    // Set up the starfield
    for (let i = 0; i < 500; i++) {
      stars.push({
        x: random(width),
        y: random(height),
        size: random(1, 3),
        alpha: random(100, 255)
      });
    }
  
    // Set the initial placeholder text
    document.getElementById('idea-input').placeholder = "Plant the seed of an idea...";
}  

function draw() {
    // 1. Set the background and draw the static starfield.
    background(10, 10, 20);
    drawStarfield();
  
    // 2. Update and draw all active particles directly on the canvas.
    image(trailLayer, 0, 0);
    drawIdeaNodes();
    noStroke();
    if (colorPalette.length > 0) { // Check if there's anything to draw
      trailLayer.noStroke();
      
      for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.lifespan -= 2;
  
        if (p.lifespan <= 0) {
            particles.splice(i, 1);
        } else {
            const c = p.color;

            // 1. Draw the live particle
            fill(red(c), green(c), blue(c), p.lifespan);
            ellipse(p.x, p.y, 5);
      
            // 2. Stamp the permanent mark
            trailLayer.fill(red(c), green(c), blue(c), 5);
            trailLayer.ellipse(p.x, p.y, 3);
        }
      }
    }  
  
    // 3. If the bicycle doesn't exist yet, we do nothing else.
    if (!bicycle) return;
    
    // Get a reference to the text input for enabling/disabling it.
    const ideaInput = document.getElementById('idea-input');
  
    // 4. Handle the bicycle's animation state machine.
    if (bicycle.isDropping) {
      // --- State A: The initial drop and bounce animation ---
      bicycle.yVelocity += bicycle.gravity;
      bicycle.y += bicycle.yVelocity;
      
      if (bicycle.y >= bicycle.groundY) {
        bicycle.y = bicycle.groundY;
        bicycle.yVelocity *= -0.6; // Reverse and dampen for a bounce.
        
        // If the bounce is tiny, the animation is over.
        if (abs(bicycle.yVelocity) < 1) {
          bicycle.isDropping = false;
          ideaInput.disabled = false; // Re-enable input.
          ideaInput.focus();
        }
      }
  
    } else if (bicycle.targetX !== null) {
        // --- State B: The animated ride to a new semantic point ---
        bicycle.px = bicycle.x;
        bicycle.py = bicycle.y;
      
        // Position interpolation (this is correct, leave it as is)
        bicycle.x = lerp(bicycle.x, bicycle.targetX, 0.03);
        bicycle.y = lerp(bicycle.y, bicycle.targetY, 0.03);
      
        // --- THIS IS THE FIX ---
        // First, calculate the ideal angle to the target, just like before.
        const angleToTarget = atan2(bicycle.targetY - bicycle.y, bicycle.targetX - bicycle.x);
        
        // Then, instead of teleporting, smoothly interpolate the bike's current angle towards the target.
        // The '0.1' is the "turning speed". Higher is faster.
        bicycle.angle = lerpAngle(bicycle.angle, angleToTarget, 0.1);
      
        // The rest of the logic remains the same...
        bicycle.speed = dist(bicycle.x, bicycle.y, bicycle.px, bicycle.py);
        bicycle.wheelRotation += bicycle.speed * 0.1;
      
        emitParticles();      
  
        // If we've arrived at the target, the animation is over.
        if (dist(bicycle.x, bicycle.y, bicycle.targetX, bicycle.targetY) < 2) {
            if (bicycle.pendingIdeaText && bicycle.arrivalPoint) {
                // 2. Add the idea to our trajectory AT THE ARRIVAL POINT.
                ideaTrajectory.push({
                  text: bicycle.pendingIdeaText,
                  x: bicycle.arrivalPoint.x,
                  y: bicycle.arrivalPoint.y
                });
                
                // 3. Clear the memory so it doesn't get added again.
                bicycle.pendingIdeaText = null;
                bicycle.arrivalPoint = null;
            }        
            bicycle.targetX = null;
            bicycle.targetY = null;
            bicycle.speed = 0;
            ideaInput.disabled = false; // Re-enable input.
            ideaInput.focus();
        }
    }
    
    // 5. Finally, draw the bicycle in its current, updated position.
    drawBicycle();
  }  
  
  

async function handleInput(inputText) {
    // Disable the text box while we process and animate
    if (!modelsReady) {
        console.log("Models not ready yet, please wait.");
        return;
    }

    const ideaInput = document.getElementById('idea-input');
    ideaInput.disabled = true;

  
    try {
            // --- THIS REPLACES THE FETCH CALL ---
        // 1. Classify Intent
        const candidate_labels = ["constructive argument", "critical challenge", "question"];
        const intent_result = await classifier(inputText, candidate_labels);
        const intent = intent_result.labels[0];

        // 2. Get Semantic Embedding
        const embedding = await encoder(inputText, { pooling: 'mean', normalize: true });
        const vector = embedding.data; // The vector is in the .data property
        
        const analysis = { intent, vector };
        console.log("Analysis complete:", analysis);
    // --- END OF REPLACEMENT ---
  
      if (gameState === 'SEEDING') {
        // For the first idea, we spawn the bike and THEN add the idea to the trajectory
        spawnBicycle(analysis.vector);
        ideaTrajectory.push({
          text: inputText,
          x: bicycle.x, // Use the actual landing position
          y: bicycle.groundY
        });
        gameState = 'DEVELOPING';
        ideaInput.placeholder = "Develop the idea...";
  
    } else if (gameState === 'DEVELOPING') {
        const newVector = analysis.vector;
      
        const dx = newVector[5] - bicycle.currentVector[5];
        const dy = newVector[8] - bicycle.currentVector[8];
        
        // NOTE: I reduced the moveScale slightly. 1000 can send the bike very far.
        // Feel free to adjust this value to your liking.
        const moveScale = 2000;
        bicycle.targetX = bicycle.x + dx * moveScale;
        bicycle.targetY = bicycle.y + dy * moveScale;
      
        // --- THIS IS THE FIX ---
        // We now use the properties from the bicycle object itself.
        bicycle.pendingIdeaText = inputText;
        bicycle.arrivalPoint = { x: bicycle.targetX, y: bicycle.targetY };
        // --- END OF FIX ---
      
        const newColor = color( map(newVector[10], -0.1, 0.1, 0, 255), map(newVector[150], -0.1, 0.1, 0, 255), map(newVector[300], -0.1, 0.1, 0, 255) );
        colorPalette.unshift(newColor);
        if (colorPalette.length > MAX_PALETTE_SIZE) { colorPalette.pop(); }
        bicycle.currentVector = newVector;
      }      
  
    } catch (error) {
      console.error("Error during analysis:", error);
      ideaInput.disabled = false;
    }
    
    // We re-enable the text box AFTER the animation is done.
    // This will be handled in the draw loop.
  }
  
function spawnBicycle(initialVector) {
    const randomX = random(width * 0.2, width * 0.8);
    const randomY = random(height * 0.2, height * 0.8);
  
    bicycle = {
      // --- POSITION & ANIMATION CHANGES ---
      groundY: randomY, // The "ground" it will land on
      x: randomX,
      y: randomY - 200, // START 200px ABOVE THE GROUND (Lower Drop)
      py: randomY - 200, // Match previous y to the new start
      yVelocity: 0,
      gravity: 0.5,
      isDropping: true,
      
      // --- ORIENTATION CHANGE ---
      angle: 0, // 0 DEGREES = HORIZONTAL (pointing right)
  
      // Target for animated rides
      targetX: null,
      targetY: null,
  
      // Core properties
      speed: 0,
      wheelRotation: 0,
      wheelRadius: 15,
      wheelBase: 25,
      currentVector: initialVector,
      pendingIdeaText: null, // To hold the text while the bike is in transit
      arrivalPoint: null    // To store the final destination coordinates  
    };
  
    const initialColor = color(
        map(initialVector[0], -0.1, 0.1, 0, 255),
        map(initialVector[50], -0.1, 0.1, 0, 255),
        map(initialVector[100], -0.1, 0.1, 0, 255)
    );
      
    // Clear the palette and add the new seed color
    colorPalette = [initialColor];
}  

function wrapEdges() {
  if (bicycle.x > width) { bicycle.x = 0; bicycle.px = bicycle.x; }
  if (bicycle.x < 0) { bicycle.x = width; bicycle.px = bicycle.x; }
  if (bicycle.y > height) { bicycle.y = 0; bicycle.py = bicycle.y; }
  if (bicycle.y < 0) { bicycle.y = height; bicycle.py = bicycle.y; }
}

function drawBicycle() {
    // --- Transformations ---
    // This is the magic. It moves the canvas origin to the bike's position
    // and rotates the entire drawing space to match the bike's angle.
    push(); // Save the current state of the canvas
    translate(bicycle.x, bicycle.y); // Move to the bicycle's location
    rotate(bicycle.angle); // Rotate to face the direction of movement
  
    // --- Style ---
    // if (colorPalette.length > 0) {
    //     stroke(colorPalette[0]); // Use the newest color (we add to the front)
    // }
    stroke(255);
      
    strokeWeight(4);
    noFill(); // Don't fill in the shapes
  
    // --- Draw the Wheels (relative to the new 0,0) ---
    const wheelRadius = bicycle.wheelRadius;
    const wheelBase = bicycle.wheelBase;
  
    // Back wheel
    circle(-wheelBase, 0, wheelRadius * 2);
    // Front wheel
    circle(wheelBase, 0, wheelRadius * 2);
  
    // Add spokes to show rotation
    // The line inside the wheel will rotate based on bicycle.wheelRotation
    line(-wheelBase, 0, -wheelBase + cos(bicycle.wheelRotation) * wheelRadius, sin(bicycle.wheelRotation) * wheelRadius);
    line(wheelBase, 0, wheelBase + cos(bicycle.wheelRotation) * wheelRadius, sin(bicycle.wheelRotation) * wheelRadius);
  
  
    // --- Draw the Frame ---
    // These coordinates are all relative to the new (0,0) origin,
    // which is now the center of the bike.
    const seatHeight = -25;
    const handleHeight = -35;
  
    // Frame connecting wheels and seat
    line(-wheelBase, 0, -5, seatHeight);
    line(wheelBase, 0, -5, seatHeight);
  
    // Seat post and seat
    line(0, seatHeight, -10, seatHeight);
  
    // Frame to handlebars
    line(wheelBase, 0, wheelBase - 5, handleHeight);
    // Handlebars
    line(wheelBase - 15, handleHeight, wheelBase + 5, handleHeight);
  
    pop(); // Restore the canvas to its original state
}
  
function emitParticles() {
    // We only emit particles if the bike is moving
    if (bicycle.speed < 0.1) return;
  
    // Calculate the world coordinates of the wheels
    const frontWheelX = bicycle.x + bicycle.wheelBase * cos(bicycle.angle);
    const frontWheelY = bicycle.y + bicycle.wheelBase * sin(bicycle.angle);
    const backWheelX = bicycle.x - bicycle.wheelBase * cos(bicycle.angle);
    const backWheelY = bicycle.y - bicycle.wheelBase * sin(bicycle.angle);
  
    // Create a few particles for each wheel
    for (let i = 0; i < 2; i++) {
      // A new particle object
    //   let p = {
    //     x: frontWheelX,
    //     y: frontWheelY,
    //     vx: random(-1, 1), // x velocity
    //     vy: random(-1, 1), // y velocity
    //     lifespan: 255 // This will be our alpha (transparency)
    //   };
    //   particles.push(p);
      
      // Do the same for the back wheel
      p = {
        x: backWheelX,
        y: backWheelY,
        vx: random(-0.5, 0.5),
        vy: random(-0.5, 0.5),
        lifespan: 255,
        color: getMixedColor()
      };
      particles.push(p);
    }
  }
  
function drawStarfield() {
    noStroke();
    for (const star of stars) {
        fill(255, star.alpha);
        ellipse(star.x, star.y, star.size);
    }
}
  
function saveArt() {
    // --- Create a "clean" version of the art for saving ---
    // 1. Redraw the background
    background(10, 10, 20);
    // 2. Redraw the starfield
    drawStarfield();
    // 3. Redraw the permanent nebula from our trailLayer
    image(trailLayer, 0, 0);
    
    // 4. NOW save the canvas. This version doesn't have the bicycle on it.
    saveCanvas('bicycle-for-the-mind', 'png');
  
    // 5. Also save the idea trajectory as a text file
    const formattedTrajectory = ideaTrajectory.map((idea, index) => {
        // Format each idea into a readable string
        return `${index + 1}. [${Math.round(idea.x)}, ${Math.round(idea.y)}] - ${idea.text}`;
    });    
    saveStrings(formattedTrajectory, 'idea-trajectory', 'txt');
  
    // The main draw() loop will automatically redraw the bicycle on the very next frame,
    // so the user will only see it disappear for a split second.
}
  
function lerpAngle(startAngle, endAngle, amount) {
    let difference = endAngle - startAngle;
    // If the difference is more than 180 degrees, go the other way around
    if (difference > PI) {
      difference -= TWO_PI;
    } else if (difference < -PI) {
      difference += TWO_PI;
    }
    return startAngle + difference * amount;
}


function getMixedColor() {
    if (colorPalette.length === 0) {
      return color(255); // Default to white if no colors exist
    }
    if (colorPalette.length === 1) {
      return colorPalette[0]; // Return the only color if there's just one
    }
  
    // Pick two different random colors from the palette
    let index1 = floor(random(colorPalette.length));
    let index2 = floor(random(colorPalette.length));
    while (index2 === index1) {
      index2 = floor(random(colorPalette.length));
    }
    
    // Blend them together at a random amount
    return lerpColor(colorPalette[index1], colorPalette[index2], random(0.2, 0.8));
}


function drawIdeaNodes() {
    const hoverRadius = 10;
    let isHovering = false;
  
    for (const idea of ideaTrajectory) {
      fill(255, 0, 0, 120);
      noStroke();
      ellipse(idea.x, idea.y, hoverRadius);
  
      if (!isHovering) {
        const distance = dist(mouseX, mouseY, idea.x, idea.y);
        if (distance < hoverRadius) {
          isHovering = true;
          
          // --- SIMPLIFIED & CORRECTED TOOLTIP LOGIC ---
          const textBoxWidth = 200;
          const textPadding = 10;
          
          // Position the box
          const boxX = idea.x + 15;
          const boxY = idea.y - 20; // A simple offset works well
  
          // Draw the background box
          fill(0, 0, 0, 180);
          stroke(255, 150);
          strokeWeight(1);
          // We give it a generous fixed height.
          rect(boxX, boxY, textBoxWidth + textPadding * 2, 80, 5); 
  
          // Draw the text, letting p5.js handle the wrapping
          noStroke();
          fill(255);
          textSize(12);
          textAlign(LEFT, TOP);
          text(idea.text, boxX + textPadding, boxY + textPadding, textBoxWidth);
        }
      }
    }
}