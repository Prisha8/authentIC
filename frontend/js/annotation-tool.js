/**
 * Annotation Tool for IC Image Analysis
 * Allows users to draw bounding boxes and add annotations
 */

class AnnotationTool {
    constructor(imageElement, containerId) {
        this.image = imageElement;
        this.container = document.getElementById(containerId);
        this.canvas = null;
        this.ctx = null;
        this.annotations = [];
        this.currentAnnotation = null;
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.sessionId = null;
        this.imagePath = null;
        this.enabled = false;
        this.instanceId = 'annotation-tool-' + Date.now();
        
        // Store reference to this instance
        window[this.instanceId] = this;
        
        this.setupCanvas();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        // Create canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'annotation-canvas';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.style.cursor = 'crosshair';
        this.canvas.style.display = 'none';
        this.canvas.style.zIndex = '10';
        
        const imgParent = this.image.parentElement;
        if (!imgParent) {
            console.error('[AnnotationTool] Image parent not found');
            return;
        }
        
        imgParent.style.position = 'relative';
        imgParent.appendChild(this.canvas);
        
        this.updateCanvasSize();
        
        // Watch for image load/resize
        if (this.image.complete) {
            this.updateCanvasSize();
        } else {
            this.image.addEventListener('load', () => this.updateCanvasSize());
        }
        window.addEventListener('resize', () => this.updateCanvasSize());
    }
    
    updateCanvasSize() {
        if (!this.image || !this.canvas) return;
        
        const rect = this.image.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx = this.canvas.getContext('2d');
        this.redraw();
    }
    
    setupEventListeners() {
        if (!this.canvas) return;
        
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.enabled) this.startDrawing(e);
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.enabled) this.draw(e);
        });
        this.canvas.addEventListener('mouseup', (e) => {
            if (this.enabled) this.finishDrawing(e);
        });
        this.canvas.addEventListener('mouseleave', () => {
            if (this.isDrawing && this.enabled) {
                this.finishDrawing();
            }
        });
    }
    
    getImageCoordinates(e) {
        if (!this.canvas) return { x: 0, y: 0 };
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.image.naturalWidth / rect.width;
        const scaleY = this.image.naturalHeight / rect.height;
        
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        return { x, y };
    }
    
    getNormalizedCoordinates(x, y, width, height) {
        if (!this.image || this.image.naturalWidth === 0 || this.image.naturalHeight === 0) {
            return { bbox_x: 0, bbox_y: 0, bbox_width: 0, bbox_height: 0 };
        }
        
        return {
            bbox_x: x / this.image.naturalWidth,
            bbox_y: y / this.image.naturalHeight,
            bbox_width: width / this.image.naturalWidth,
            bbox_height: height / this.image.naturalHeight
        };
    }
    
    startDrawing(e) {
        this.isDrawing = true;
        const coords = this.getImageCoordinates(e);
        this.startX = coords.x;
        this.startY = coords.y;
    }
    
    draw(e) {
        if (!this.isDrawing || !this.ctx) return;
        
        const coords = this.getImageCoordinates(e);
        const width = coords.x - this.startX;
        const height = coords.y - this.startY;
        
        this.redraw();
        
        // Draw current box
        this.ctx.strokeStyle = '#3b82f6';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([]);
        
        const rect = this.image.getBoundingClientRect();
        const scaleX = rect.width / this.image.naturalWidth;
        const scaleY = rect.height / this.image.naturalHeight;
        
        this.ctx.strokeRect(
            (this.startX * scaleX),
            (this.startY * scaleY),
            (width * scaleX),
            (height * scaleY)
        );
    }
    
    finishDrawing(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        
        const coords = e ? this.getImageCoordinates(e) : { x: this.startX, y: this.startY };
        const width = coords.x - this.startX;
        const height = coords.y - this.startY;
        
        // Only create annotation if box is meaningful size
        if (Math.abs(width) < 10 || Math.abs(height) < 10) {
            this.redraw();
            return;
        }
        
        // Normalize coordinates
        const normalized = this.getNormalizedCoordinates(
            Math.min(this.startX, coords.x),
            Math.min(this.startY, coords.y),
            Math.abs(width),
            Math.abs(height)
        );
        
        this.showAnnotationForm(normalized);
        this.redraw();
    }
    
    showAnnotationForm(bbox) {
        // Remove existing modal if any
        const existingModal = document.querySelector('.annotation-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.className = 'annotation-modal';
        modal.innerHTML = `
            <div class="annotation-modal-content">
                <h3>Add Annotation</h3>
                <div class="form-group">
                    <label>Label *</label>
                    <input type="text" id="annotation-label" placeholder="e.g., Suspicious marking">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="annotation-description" rows="3" placeholder="Describe what you see..."></textarea>
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <select id="annotation-type">
                        <option value="anomaly">Anomaly</option>
                        <option value="feature">Feature</option>
                        <option value="verification">Verification</option>
                        <option value="feedback">Feedback</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Severity</label>
                    <select id="annotation-severity">
                        <option value="">None</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="annotation-corrects-ai">
                        This corrects AI analysis
                    </label>
                </div>
                <div class="form-actions">
                    <button class="btn-cancel" onclick="this.closest('.annotation-modal').remove()">Cancel</button>
                    <button class="btn-primary" data-tool-instance="${this.instanceId}" onclick="const tool = window[this.dataset.toolInstance]; if(tool) tool.saveAnnotation(${JSON.stringify(bbox).replace(/"/g, '&quot;')})">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }
    
    async saveAnnotation(bbox) {
        const modal = document.querySelector('.annotation-modal');
        if (!modal) return;
        
        const label = document.getElementById('annotation-label')?.value || '';
        const description = document.getElementById('annotation-description')?.value || '';
        const type = document.getElementById('annotation-type')?.value || 'feature';
        const severity = document.getElementById('annotation-severity')?.value || '';
        const correctsAI = document.getElementById('annotation-corrects-ai')?.checked || false;
        
        if (!label.trim()) {
            alert('Please enter a label');
            return;
        }
        
        if (!this.sessionId) {
            alert('Session ID not set. Cannot save annotation.');
            return;
        }
        
        const annotation = {
            session_id: this.sessionId,
            image_path: this.imagePath || '',
            ...bbox,
            label: label,
            description: description,
            annotation_type: type,
            severity: severity || null,
            correction_to_ai: correctsAI
        };
        
        try {
            const response = await fetch('http://localhost:5001/api/annotations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(annotation)
            });
            
            const result = await response.json();
            if (result.success) {
                annotation.annotation_id = result.annotation_id;
                this.annotations.push(annotation);
                this.redraw();
                modal.remove();
                
                // Trigger annotation saved event
                window.dispatchEvent(new CustomEvent('annotation-saved', { detail: annotation }));
                
                // Show success message
                const successMsg = document.createElement('div');
                successMsg.className = 'annotation-success-msg';
                successMsg.textContent = 'Annotation saved successfully!';
                document.body.appendChild(successMsg);
                setTimeout(() => successMsg.remove(), 2000);
            } else {
                alert('Failed to save annotation: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving annotation:', error);
            alert('Error saving annotation: ' + error.message);
        }
    }
    
    redraw() {
        if (!this.ctx || !this.image) return;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const rect = this.image.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const scaleX = rect.width / this.image.naturalWidth;
        const scaleY = rect.height / this.image.naturalHeight;
        
        this.annotations.forEach((ann, idx) => {
            if (!ann.bbox_x && ann.bbox_x !== 0) return;
            
            const x = ann.bbox_x * this.image.naturalWidth * scaleX;
            const y = ann.bbox_y * this.image.naturalHeight * scaleY;
            const w = ann.bbox_width * this.image.naturalWidth * scaleX;
            const h = ann.bbox_height * this.image.naturalHeight * scaleY;
            
            // Box color based on type
            const colors = {
                'anomaly': '#ef4444',
                'feature': '#3b82f6',
                'verification': '#10b981',
                'feedback': '#f59e0b'
            };
            
            const color = colors[ann.annotation_type] || '#3b82f6';
            
            // Draw box
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x, y, w, h);
            
            // Draw label background
            const labelText = ann.label || `Annotation ${idx + 1}`;
            this.ctx.font = '12px sans-serif';
            const textMetrics = this.ctx.measureText(labelText);
            const textWidth = textMetrics.width;
            const textHeight = 16;
            
            this.ctx.fillStyle = color;
            this.ctx.fillRect(x, y - textHeight - 2, textWidth + 8, textHeight);
            
            // Draw label text
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(labelText, x + 4, y - 4);
        });
    }
    
    async loadAnnotations(sessionId, imagePath) {
        this.sessionId = sessionId;
        this.imagePath = imagePath;
        
        try {
            const response = await fetch(`http://localhost:5001/api/annotations/${sessionId}`);
            const data = await response.json();
            
            // Filter annotations for this image
            this.annotations = (data.annotations || []).filter(a => 
                a.image_path === imagePath || !imagePath
            );
            this.redraw();
        } catch (error) {
            console.error('Error loading annotations:', error);
        }
    }
    
    enable() {
        this.enabled = true;
        if (this.canvas) {
            this.canvas.style.display = 'block';
        }
    }
    
    disable() {
        this.enabled = false;
        if (this.canvas) {
            this.canvas.style.display = 'none';
        }
    }
    
    clear() {
        this.annotations = [];
        this.redraw();
    }
}

// Make available globally
window.AnnotationTool = AnnotationTool;

