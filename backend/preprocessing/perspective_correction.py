"""
Perspective Correction Module
=============================
Implements advanced perspective correction techniques including:
- Automatic document corner detection
- Homography-based perspective transformation
- Contour-based document detection
- Hough line-based correction

Best performing methods for document/image perspective correction.
"""

import cv2
import numpy as np
from typing import List, Optional, Tuple, Union


class PerspectiveCorrector:
    """
    Advanced perspective correction using homography transformation.
    """
    
    def __init__(
        self,
        target_width: int = 800,
        target_height: int = 1000,
        auto_size: bool = True
    ):
        """
        Initialize the PerspectiveCorrector.
        
        Args:
            target_width: Default output width
            target_height: Default output height
            auto_size: If True, automatically determine output size from input
        """
        self.target_width = target_width
        self.target_height = target_height
        self.auto_size = auto_size
    
    def order_points(self, pts: np.ndarray) -> np.ndarray:
        """
        Order points in clockwise order: top-left, top-right, bottom-right, bottom-left.
        
        Args:
            pts: Array of 4 points
            
        Returns:
            Ordered points array
        """
        rect = np.zeros((4, 2), dtype=np.float32)
        
        # Sum and diff to find corners
        s = pts.sum(axis=1)
        diff = np.diff(pts, axis=1)
        
        rect[0] = pts[np.argmin(s)]      # Top-left has smallest sum
        rect[2] = pts[np.argmax(s)]      # Bottom-right has largest sum
        rect[1] = pts[np.argmin(diff)]   # Top-right has smallest difference
        rect[3] = pts[np.argmax(diff)]   # Bottom-left has largest difference
        
        return rect
    
    def calculate_output_size(
        self,
        pts: np.ndarray
    ) -> Tuple[int, int]:
        """
        Calculate optimal output size based on input quadrilateral.
        
        Args:
            pts: Ordered corner points
            
        Returns:
            Tuple of (width, height)
        """
        rect = self.order_points(pts)
        (tl, tr, br, bl) = rect
        
        # Compute width as max of top and bottom edges
        width_top = np.linalg.norm(tr - tl)
        width_bottom = np.linalg.norm(br - bl)
        width = max(int(width_top), int(width_bottom))
        
        # Compute height as max of left and right edges
        height_left = np.linalg.norm(bl - tl)
        height_right = np.linalg.norm(br - tr)
        height = max(int(height_left), int(height_right))
        
        return width, height
    
    def apply_homography(
        self,
        image: np.ndarray,
        src_points: np.ndarray,
        dst_points: Optional[np.ndarray] = None,
        output_size: Optional[Tuple[int, int]] = None
    ) -> np.ndarray:
        """
        Apply perspective transformation using homography matrix.
        
        Args:
            image: Input image
            src_points: Source corner points (4 points)
            dst_points: Destination corner points (computed if None)
            output_size: Output (width, height) tuple
            
        Returns:
            Perspective-corrected image
        """
        src = self.order_points(src_points.astype(np.float32))
        
        # Determine output size
        if output_size is None:
            if self.auto_size:
                width, height = self.calculate_output_size(src)
            else:
                width, height = self.target_width, self.target_height
        else:
            width, height = output_size
        
        # Create destination points if not provided
        if dst_points is None:
            dst = np.array([
                [0, 0],
                [width - 1, 0],
                [width - 1, height - 1],
                [0, height - 1]
            ], dtype=np.float32)
        else:
            dst = self.order_points(dst_points.astype(np.float32))
        
        # Compute homography matrix
        H, _ = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        
        # Apply perspective transformation
        warped = cv2.warpPerspective(image, H, (width, height))
        
        return warped
    
    def detect_document_contour(
        self,
        image: np.ndarray,
        blur_kernel: int = 5,
        canny_low: int = 50,
        canny_high: int = 200
    ) -> Optional[np.ndarray]:
        """
        Automatically detect document corners using contour detection.
        
        Args:
            image: Input image
            blur_kernel: Gaussian blur kernel size
            canny_low: Canny edge detection lower threshold
            canny_high: Canny edge detection upper threshold
            
        Returns:
            Array of 4 corner points or None if not detected
        """
        # Convert to grayscale
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Apply Gaussian blur
        blurred = cv2.GaussianBlur(gray, (blur_kernel, blur_kernel), 0)
        
        # Edge detection
        edges = cv2.Canny(blurred, canny_low, canny_high)
        
        # Dilate to close gaps
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=1)
        
        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            return None
        
        # Calculate minimum area threshold (1% of image area)
        h, w = gray.shape[:2]
        min_area = h * w * 0.01
        
        # Sort contours by area (largest first) and filter small ones
        contours = sorted(contours, key=cv2.contourArea, reverse=True)
        
        # Find quadrilateral contour
        for contour in contours[:5]:  # Check top 5 largest
            # Early exit if contour too small
            area = cv2.contourArea(contour)
            if area < min_area:
                break
            
            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            
            if len(approx) == 4:
                return approx.reshape(4, 2).astype(np.float32)
        
        return None
    
    def detect_corners_harris(
        self,
        image: np.ndarray,
        block_size: int = 2,
        ksize: int = 3,
        k: float = 0.04
    ) -> Optional[np.ndarray]:
        """
        Detect corners using Harris corner detection.
        
        Args:
            image: Input image
            block_size: Size of neighborhood for corner detection
            ksize: Aperture parameter for Sobel operator
            k: Harris detector free parameter
            
        Returns:
            Array of corner points or None
        """
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        gray = np.float32(gray)
        
        # Harris corner detection
        harris = cv2.cornerHarris(gray, block_size, ksize, k)
        harris = cv2.dilate(harris, None)
        
        # Threshold
        thresh = 0.01 * harris.max()
        corners = np.argwhere(harris > thresh)
        
        if len(corners) < 4:
            return None
        
        # Convert to (x, y) format
        corners = corners[:, ::-1].astype(np.float32)
        
        # Use k-means to find 4 corner clusters
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
        _, _, centers = cv2.kmeans(corners, 4, None, criteria, 10, cv2.KMEANS_PP_CENTERS)
        
        return centers
    
    def detect_document_hough(
        self,
        image: np.ndarray,
        rho: float = 1,
        theta: float = np.pi / 180,
        threshold: int = 100
    ) -> Optional[np.ndarray]:
        """
        Detect document edges using Hough line transform.
        
        Args:
            image: Input image
            rho: Distance resolution in pixels
            theta: Angle resolution in radians
            threshold: Accumulator threshold
            
        Returns:
            Array of 4 corner points or None
        """
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Edge detection
        edges = cv2.Canny(gray, 50, 150)
        
        # Hough line detection
        lines = cv2.HoughLines(edges, rho, theta, threshold)
        
        if lines is None or len(lines) < 4:
            return None
        
        # Group lines by angle (horizontal vs vertical)
        horizontal_lines = []
        vertical_lines = []
        
        for line in lines:
            rho_val, theta_val = line[0]
            angle = np.degrees(theta_val)
            
            if 45 < angle < 135:  # Horizontal
                horizontal_lines.append((rho_val, theta_val))
            else:  # Vertical
                vertical_lines.append((rho_val, theta_val))
        
        if len(horizontal_lines) < 2 or len(vertical_lines) < 2:
            return None
        
        # Find line intersections
        def line_intersection(line1, line2):
            rho1, theta1 = line1
            rho2, theta2 = line2
            
            A = np.array([
                [np.cos(theta1), np.sin(theta1)],
                [np.cos(theta2), np.sin(theta2)]
            ])
            b = np.array([rho1, rho2])
            
            try:
                x, y = np.linalg.solve(A, b)
                return (x, y)
            except np.linalg.LinAlgError:
                return None
        
        # Get 4 corners from intersections
        corners = []
        for h_line in horizontal_lines[:2]:
            for v_line in vertical_lines[:2]:
                point = line_intersection(h_line, v_line)
                if point is not None:
                    corners.append(point)
        
        if len(corners) != 4:
            return None
        
        return np.array(corners, dtype=np.float32)
    
    def auto_correct_perspective(
        self,
        image: np.ndarray,
        method: str = "contour"
    ) -> Tuple[np.ndarray, Optional[np.ndarray]]:
        """
        Automatically detect and correct perspective distortion.
        
        Args:
            image: Input image
            method: Detection method ("contour", "harris", "hough")
            
        Returns:
            Tuple of (corrected image, detected corners)
        """
        # Detect corners based on method
        if method == "contour":
            corners = self.detect_document_contour(image)
        elif method == "harris":
            corners = self.detect_corners_harris(image)
        elif method == "hough":
            corners = self.detect_document_hough(image)
        else:
            raise ValueError(f"Unknown method: {method}")
        
        if corners is None:
            # Return original if detection fails
            return image.copy(), None
        
        # Apply perspective correction
        corrected = self.apply_homography(image, corners)
        
        return corrected, corners
    
    def correct_with_reference(
        self,
        image: np.ndarray,
        reference_image: np.ndarray,
        feature_detector: str = "ORB"
    ) -> np.ndarray:
        """
        Correct perspective using feature matching with a reference image.
        
        Args:
            image: Input distorted image
            reference_image: Reference (correctly oriented) image
            feature_detector: Feature detector to use ("ORB", "SIFT", "AKAZE")
            
        Returns:
            Perspective-corrected image
        """
        # Create feature detector
        if feature_detector == "ORB":
            detector = cv2.ORB_create(nfeatures=5000)
        elif feature_detector == "SIFT":
            detector = cv2.SIFT_create()
        elif feature_detector == "AKAZE":
            detector = cv2.AKAZE_create()
        else:
            raise ValueError(f"Unknown detector: {feature_detector}")
        
        # Convert to grayscale
        if len(image.shape) == 3:
            gray_img = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray_img = image
        
        if len(reference_image.shape) == 3:
            gray_ref = cv2.cvtColor(reference_image, cv2.COLOR_BGR2GRAY)
        else:
            gray_ref = reference_image
        
        # Detect keypoints and compute descriptors
        kp1, desc1 = detector.detectAndCompute(gray_img, None)
        kp2, desc2 = detector.detectAndCompute(gray_ref, None)
        
        if desc1 is None or desc2 is None:
            return image.copy()
        
        # Create matcher
        if feature_detector == "SIFT":
            matcher = cv2.BFMatcher(cv2.NORM_L2)
        else:
            matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        
        # Match features
        matches = matcher.knnMatch(desc1, desc2, k=2)
        
        # Apply Lowe's ratio test
        good_matches = []
        for m, n in matches:
            if m.distance < 0.75 * n.distance:
                good_matches.append(m)
        
        if len(good_matches) < 4:
            return image.copy()
        
        # Extract matched points
        src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
        
        # Compute homography
        H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        
        if H is None:
            return image.copy()
        
        # Warp image
        h, w = reference_image.shape[:2]
        corrected = cv2.warpPerspective(image, H, (w, h))
        
        return corrected
    
    def manual_four_point_transform(
        self,
        image: np.ndarray,
        points: List[Tuple[int, int]]
    ) -> np.ndarray:
        """
        Apply four-point perspective transform with manually specified corners.
        
        Args:
            image: Input image
            points: List of 4 corner points as (x, y) tuples
            
        Returns:
            Perspective-corrected image
        """
        pts = np.array(points, dtype=np.float32)
        return self.apply_homography(image, pts)
    
    def correct_rotation(
        self,
        image: np.ndarray,
        angle: Optional[float] = None
    ) -> np.ndarray:
        """
        Correct image rotation (deskew).
        
        Args:
            image: Input image
            angle: Rotation angle in degrees (auto-detected if None)
            
        Returns:
            Rotation-corrected image
        """
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Auto-detect angle using Hough transform
        if angle is None:
            edges = cv2.Canny(gray, 50, 150)
            lines = cv2.HoughLinesP(
                edges, 1, np.pi / 180, 100,
                minLineLength=100, maxLineGap=10
            )
            
            if lines is None:
                return image.copy()
            
            # Calculate dominant angle
            angles = []
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle_rad = np.arctan2(y2 - y1, x2 - x1)
                angle_deg = np.degrees(angle_rad)
                
                # Normalize to [-45, 45] range
                if angle_deg < -45:
                    angle_deg += 90
                elif angle_deg > 45:
                    angle_deg -= 90
                
                angles.append(angle_deg)
            
            angle = np.median(angles)
        
        # Rotate image
        h, w = image.shape[:2]
        center = (w // 2, h // 2)
        
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        
        # Calculate new bounding box size
        cos = np.abs(M[0, 0])
        sin = np.abs(M[0, 1])
        new_w = int(h * sin + w * cos)
        new_h = int(h * cos + w * sin)
        
        # Adjust rotation matrix
        M[0, 2] += (new_w - w) / 2
        M[1, 2] += (new_h - h) / 2
        
        rotated = cv2.warpAffine(image, M, (new_w, new_h), borderValue=(255, 255, 255))
        
        return rotated


def process_image(
    image_path: str,
    output_path: Optional[str] = None,
    method: str = "contour",
    corners: Optional[List[Tuple[int, int]]] = None
) -> np.ndarray:
    """
    Convenience function to process a single image.
    
    Args:
        image_path: Path to input image
        output_path: Optional path to save result
        method: Detection method ("contour", "harris", "hough", "manual")
        corners: Manual corner points (required if method is "manual")
        
    Returns:
        Perspective-corrected image
    """
    image = cv2.imread(image_path)
    if image is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")
    
    corrector = PerspectiveCorrector()
    
    if method == "manual":
        if corners is None:
            raise ValueError("Corners must be provided for manual method")
        result = corrector.manual_four_point_transform(image, corners)
    else:
        result, detected_corners = corrector.auto_correct_perspective(image, method)
        if detected_corners is not None:
            print(f"Detected corners: {detected_corners.tolist()}")
    
    if output_path:
        cv2.imwrite(output_path, result)
    
    return result


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python perspective_correction.py <image_path> [output_path]")
        print("\nMethods available:")
        print("  - contour: Contour-based document detection (default)")
        print("  - harris: Harris corner detection")
        print("  - hough: Hough line-based detection")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    result = process_image(input_path, output_path, method="contour")
    
    if output_path:
        print(f"Saved result to: {output_path}")
    else:
        cv2.imshow("Perspective Corrected", result)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
