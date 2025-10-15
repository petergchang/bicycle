from flask import Flask, request, jsonify
from flask_cors import CORS
from transformers import pipeline
from sentence_transformers import SentenceTransformer
import logging

# Configure basic logging
logging.basicConfig(level=logging.INFO)

# Initialize Flask App
app = Flask(__name__)
# This more specific configuration is better at handling preflight requests
CORS(app, resources={r"/analyze": {"origins": "*"}})

# --- Load AI Models ---
# This part can be slow the first time you run the server.
# The models are downloaded and cached.
app.logger.info("Loading AI models, this may take a moment...")

# For classifying intent (offense vs. defense)
classifier = pipeline("zero-shot-classification", model="facebook/bart-large-mnli")

# For turning text into a semantic vector (an array of numbers representing meaning)
encoder = SentenceTransformer("all-MiniLM-L6-v2") 

app.logger.info("Models loaded successfully.")
# --- End Model Loading ---


@app.route('/analyze', methods=['POST'])
def analyze_text():
    data = request.json
    text_input = data.get('text', '')
    app.logger.info(f"Received text for analysis: '{text_input}'")

    if not text_input:
        return jsonify({"error": "No text provided"}), 400

    # 1. Classify Intent
    candidate_labels = ["constructive argument", "critical challenge", "question"]
    intent_result = classifier(text_input, candidate_labels)
    
    intent = intent_result['labels'][0]

    # 2. Get Semantic Embedding
    vector = encoder.encode(text_input).tolist()

    # 3. Prepare the response
    response_data = {
        "intent": intent,
        "vector": vector 
    }
    app.logger.info(f"Analysis result: {response_data['intent']}")

    return jsonify(response_data)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)