"""
Glare Reduction Module
======================
Implements advanced glare reduction techniques including:
- CLAHE (Contrast Limited Adaptive Histogram Equalization)
- Multi-frame Averaging for temporal noise/glare reduction
- Specular Highlight Detection and Inpainting

Best performing methods for document/image glare removal.
"""

import cv2
import numpy as np
from typing import List, Optional, Tuple


class GlareReducer:
    """
    Advanced glare reduction using multiple techniques.
    """
    
    def __init__(
        self,
        clip_limit: float = 2.0,
        tile_grid_size: Tuple[int, int] = (8, 8),
        specular_threshold: int = 250
    ):
        """
        Initialize the GlareReducer.
        
        Args:
            clip_limit: Threshold for contrast limiting in CLAHE (default: 2.0)
            tile_grid_size: Size of grid for histogram equalization (default: 8x8)
            specular_threshold: Threshold for detecting specular highlights (default: 250)
        """
        self.clip_limit = clip_limit
        self.tile_grid_size = tile_grid_size
        self.specular_threshold = specular_threshold
        self.clahe = cv2.createCLAHE(
            clipLimit=self.clip_limit,
            tileGridSize=self.tile_grid_size
        )
    
    def apply_clahe(self, image: np.ndarray) -> np.ndarray:
        """
        Apply CLAHE to reduce glare and enhance local contrast.
        
        Works on both grayscale and color images. For color images,
        converts to LAB color space and applies CLAHE to the L channel.
        
        Args:
            image: Input image (BGR or grayscale)
            
        Returns:
            Glare-reduced image with enhanced contrast
        """
        if len(image.shape) == 2:
            # Grayscale image
            return self.clahe.apply(image)
        
        # Color image - convert to LAB and apply CLAHE to L channel
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)
        
        # Apply CLAHE to L channel
        l_enhanced = self.clahe.apply(l_channel)
        
        # Merge channels and convert back to BGR
        enhanced_lab = cv2.merge([l_enhanced, a_channel, b_channel])
        enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
        
        return enhanced_bgr
    
    def apply_clahe_hsv(self, image: np.ndarray) -> np.ndarray:
        """
        Alternative CLAHE implementation using HSV color space.
        
        Sometimes performs better for images with colored glare.
        
        Args:
            image: Input BGR image
            
        Returns:
            Glare-reduced image
        """
        if len(image.shape) == 2:
            return self.clahe.apply(image)
        
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        h, s, v = cv2.split(hsv)
        
        # Apply CLAHE to V (Value) channel
        v_enhanced = self.clahe.apply(v)
        
        enhanced_hsv = cv2.merge([h, s, v_enhanced])
        enhanced_bgr = cv2.cvtColor(enhanced_hsv, cv2.COLOR_HSV2BGR)
        
        return enhanced_bgr
    
    def detect_specular_highlights(
        self,
        image: np.ndarray,
        threshold: Optional[int] = None
    ) -> np.ndarray:
        """
        Detect specular highlights (bright glare spots) in the image.
        
        Args:
            image: Input image
            threshold: Brightness threshold for detection (uses default if None)
            
        Returns:
            Binary mask where specular highlights are white (255)
        """
        if threshold is None:
            threshold = self.specular_threshold
        
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Create mask for specular highlights
        _, mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
        
        # Dilate to ensure complete coverage
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.dilate(mask, kernel, iterations=2)
        
        return mask
    
    def inpaint_specular_highlights(
        self,
        image: np.ndarray,
        mask: Optional[np.ndarray] = None,
        inpaint_radius: int = 5
    ) -> np.ndarray:
        """
        Remove specular highlights using inpainting.
        
        Args:
            image: Input image
            mask: Optional pre-computed highlight mask
            inpaint_radius: Radius of neighborhood for inpainting
            
        Returns:
            Image with specular highlights inpainted
        """
        if mask is None:
            mask = self.detect_specular_highlights(image)
        
        # Use Telea algorithm for better results
        inpainted = cv2.inpaint(image, mask, inpaint_radius, cv2.INPAINT_TELEA)
        
        return inpainted
    
    def frame_averaging(
        self,
        frames: List[np.ndarray],
        weights: Optional[List[float]] = None
    ) -> np.ndarray:
        """
        Reduce glare through multi-frame averaging.
        
        Best used when multiple frames of the same scene are available.
        Temporal averaging helps reduce specular reflections that vary
        between frames.
        
        Args:
            frames: List of frames (must all be same size)
            weights: Optional weights for each frame (uniform if None)
            
        Returns:
            Averaged frame with reduced glare
        """
        n_frames = len(frames)
        if n_frames == 0:
            raise ValueError("At least one frame is required")
        
        if n_frames == 1:
            return frames[0].copy()
        
        # Stack frames for vectorized operations
        stacked = np.stack(frames, axis=0)
        
        # Validate all frames have same shape (implicit from stack)
        # Set up weights - numpy's average handles normalization
        if weights is None:
            # Equal weights - use simple mean for speed
            result = np.mean(stacked, axis=0)
        else:
            # Weighted average - numpy handles normalization
            weights_arr = np.array(weights, dtype=np.float64)
            result = np.average(stacked, axis=0, weights=weights_arr)
        
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def median_frame_fusion(self, frames: List[np.ndarray]) -> np.ndarray:
        """
        Use median fusion for glare reduction.
        
        More robust to outliers (sudden glare) than averaging.
        
        Args:
            frames: List of frames
            
        Returns:
            Median-fused frame
        """
        if len(frames) == 0:
            raise ValueError("At least one frame is required")
        
        stacked = np.stack(frames, axis=0)
        median = np.median(stacked, axis=0).astype(np.uint8)
        
        return median
    
    def adaptive_glare_reduction(
        self,
        image: np.ndarray,
        use_inpainting: bool = True
    ) -> np.ndarray:
        """
        Complete adaptive glare reduction pipeline.
        
        Combines CLAHE with specular highlight detection and inpainting
        for best results.
        
        Args:
            image: Input image
            use_inpainting: Whether to inpaint specular highlights
            
        Returns:
            Glare-reduced image
        """
        # Step 1: Detect and optionally inpaint specular highlights
        if use_inpainting:
            mask = self.detect_specular_highlights(image)
            if np.sum(mask) > 0:  # Only inpaint if highlights detected
                image = self.inpaint_specular_highlights(image, mask)
        
        # Step 2: Apply CLAHE for contrast enhancement
        result = self.apply_clahe(image)
        
        return result
    
    def reduce_glare_with_bilateral(
        self,
        image: np.ndarray,
        d: int = 9,
        sigma_color: float = 75,
        sigma_space: float = 75
    ) -> np.ndarray:
        """
        Reduce glare using bilateral filtering followed by CLAHE.
        
        Bilateral filter preserves edges while smoothing out glare.
        
        Args:
            image: Input image
            d: Diameter of pixel neighborhood
            sigma_color: Filter sigma in color space
            sigma_space: Filter sigma in coordinate space
            
        Returns:
            Glare-reduced image
        """
        # Apply bilateral filter to smooth glare while preserving edges
        filtered = cv2.bilateralFilter(image, d, sigma_color, sigma_space)
        
        # Apply CLAHE for contrast enhancement
        result = self.apply_clahe(filtered)
        
        return result


def process_image(
    image_path: str,
    output_path: Optional[str] = None,
    method: str = "adaptive"
) -> np.ndarray:
    """
    Convenience function to process a single image.
    
    Args:
        image_path: Path to input image
        output_path: Optional path to save result
        method: Method to use ("clahe", "adaptive", "bilateral")
        
    Returns:
        Processed image
    """
    image = cv2.imread(image_path)
    if image is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")
    
    reducer = GlareReducer()
    
    if method == "clahe":
        result = reducer.apply_clahe(image)
    elif method == "adaptive":
        result = reducer.adaptive_glare_reduction(image)
    elif method == "bilateral":
        result = reducer.reduce_glare_with_bilateral(image)
    else:
        raise ValueError(f"Unknown method: {method}")
    
    if output_path:
        cv2.imwrite(output_path, result)
    
    return result


def process_video_frames(
    frames: List[np.ndarray],
    method: str = "median"
) -> np.ndarray:
    """
    Process multiple video frames for glare reduction.
    
    Args:
        frames: List of video frames
        method: Method to use ("average", "median")
        
    Returns:
        Single glare-reduced frame
    """
    reducer = GlareReducer()
    
    if method == "average":
        fused = reducer.frame_averaging(frames)
    elif method == "median":
        fused = reducer.median_frame_fusion(frames)
    else:
        raise ValueError(f"Unknown method: {method}")
    
    # Apply CLAHE to the fused result
    result = reducer.apply_clahe(fused)
    
    return result


if __name__ == "__main__":
    # Example usage
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python glare_reduction.py <image_path> [output_path]")
        print("\nMethods available:")
        print("  - clahe: CLAHE only")
        print("  - adaptive: CLAHE + specular highlight inpainting")
        print("  - bilateral: Bilateral filter + CLAHE")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    result = process_image(input_path, output_path, method="adaptive")
    
    if output_path:
        print(f"Saved result to: {output_path}")
    else:
        cv2.imshow("Glare Reduced", result)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
