#!/usr/bin/env python3
"""
Generate nicely formatted PDF reports for wake-up emotional analysis
"""
from datetime import datetime
from io import BytesIO
from typing import Dict, List, Any
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT


class PDFReportGenerator:
    """Generate professional PDF reports for wake-up emotional analysis"""

    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()

    def _setup_custom_styles(self):
        """Setup custom styles for the PDF"""
        # Title style
        self.styles.add(ParagraphStyle(
            name='CustomTitle',
            parent=self.styles['Title'],
            fontSize=24,
            textColor=colors.HexColor('#1e3a8a'),  # Dark blue
            spaceAfter=30,
            alignment=TA_CENTER,
        ))

        # Subtitle style
        self.styles.add(ParagraphStyle(
            name='CustomSubtitle',
            parent=self.styles['Heading2'],
            fontSize=16,
            textColor=colors.HexColor('#4b5563'),  # Gray
            spaceAfter=20,
            alignment=TA_CENTER,
        ))

        # Heading style
        self.styles.add(ParagraphStyle(
            name='CustomHeading',
            parent=self.styles['Heading3'],
            fontSize=14,
            textColor=colors.HexColor('#1e40af'),  # Medium blue
            spaceAfter=12,
            spaceBefore=20,
        ))

        # Normal text style
        self.styles.add(ParagraphStyle(
            name='CustomNormal',
            parent=self.styles['Normal'],
            fontSize=11,
            textColor=colors.HexColor('#374151'),  # Dark gray
            spaceAfter=10,
        ))

        # Small text style
        self.styles.add(ParagraphStyle(
            name='CustomSmall',
            parent=self.styles['Normal'],
            fontSize=9,
            textColor=colors.HexColor('#6b7280'),  # Medium gray
            spaceAfter=6,
        ))

    def generate_report(
        self,
        emotion_log: List[Dict[str, Any]],
        agent_data: Dict[str, Any],
        feelings_data: Dict[str, Any]
    ) -> bytes:
        """
        Generate a PDF report from emotion data

        Args:
            emotion_log: List of emotion entries with timestamps
            agent_data: Agent state data
            feelings_data: Current feelings state

        Returns:
            PDF file as bytes
        """
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=72,
            leftMargin=72,
            topMargin=72,
            bottomMargin=72,
        )

        story = []
        self._add_title(story, agent_data)
        self._add_summary(story, emotion_log, feelings_data)
        self._add_timeline(story, emotion_log)
        self._add_engagement_analysis(story, emotion_log)
        self._add_social_signals(story, emotion_log)
        self._add_quality_metrics(story, emotion_log)
        self._add_footer(story)

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()

    def _add_title(self, story: List, agent_data: Dict):
        """Add title section"""
        story.append(Paragraph("Wake-Up Emotional Analysis Report", self.styles['CustomTitle']))
        
        timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p")
        story.append(Paragraph(f"Generated on {timestamp}", self.styles['CustomSubtitle']))
        story.append(Spacer(1, 20))

        # Add robot info if available
        if agent_data.get("phase"):
            phase = agent_data.get("phase", "unknown").title()
            story.append(Paragraph(f"Current Phase: {phase}", self.styles['CustomNormal']))
            story.append(Spacer(1, 10))

    def _add_summary(self, story: List, emotion_log: List, feelings_data: Dict):
        """Add summary section"""
        story.append(Paragraph("Executive Summary", self.styles['CustomHeading']))

        if not emotion_log:
            story.append(Paragraph("No emotion data available. Complete a wake-up cycle to generate a report.", self.styles['CustomNormal']))
            story.append(Spacer(1, 20))
            return

        # Calculate summary statistics
        total_entries = len(emotion_log)
        engaged_count = sum(1 for e in emotion_log if e.get("engagement") == "engaged")
        disengaged_count = sum(1 for e in emotion_log if e.get("engagement") == "disengaged")
        neutral_count = sum(1 for e in emotion_log if e.get("engagement") == "neutral")

        total_signals = sum(len(e.get("signals", [])) for e in emotion_log)
        avg_quality = sum(e.get("quality_index", 0) for e in emotion_log if e.get("quality_index")) / max(1, sum(1 for e in emotion_log if e.get("quality_index")))

        summary_data = [
            ["Metric", "Value"],
            ["Total Emotion Entries", str(total_entries)],
            ["Engaged Moments", str(engaged_count)],
            ["Disengaged Moments", str(disengaged_count)],
            ["Neutral Moments", str(neutral_count)],
            ["Total Social Signals Detected", str(total_signals)],
            ["Average Quality Index", f"{avg_quality:.1f}/10"],
        ]

        table = Table(summary_data, colWidths=[2.5 * inch, 2.5 * inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#dbeafe')),  # Light blue header
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e3a8a')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8fafc')),  # Light gray rows
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e5e7eb')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))

        story.append(table)
        story.append(Spacer(1, 30))

    def _add_timeline(self, story: List, emotion_log: List):
        """Add emotion timeline section"""
        story.append(Paragraph("Emotional Timeline", self.styles['CustomHeading']))

        if not emotion_log:
            story.append(Paragraph("No timeline data available.", self.styles['CustomNormal']))
            story.append(Spacer(1, 20))
            return

        timeline_data = [["Time", "Engagement", "Social Signals", "Quality"]]
        
        for i, entry in enumerate(emotion_log[:20]):  # Limit to first 20 entries
            timestamp = datetime.fromtimestamp(entry.get("timestamp", 0)).strftime("%I:%M:%S %p")
            engagement = entry.get("engagement", "unknown").title()
            signals = ", ".join([s.get("type", "unknown") for s in entry.get("signals", [])[:3]])
            quality = f"{entry.get('quality_index', 0):.1f}/10" if entry.get('quality_index') else "N/A"
            
            timeline_data.append([timestamp, engagement, signals, quality])

        table = Table(timeline_data, colWidths=[1.2 * inch, 1.5 * inch, 2.0 * inch, 1.0 * inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#dbeafe')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e3a8a')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white if len(timeline_data) % 2 == 0 else colors.HexColor('#f9fafb')),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e5e7eb')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('WORDWRAP', (0, 0), (-1, -1), True),
        ]))

        story.append(table)
        story.append(Spacer(1, 20))

    def _add_engagement_analysis(self, story: List, emotion_log: List):
        """Add engagement analysis section"""
        story.append(Paragraph("Engagement Analysis", self.styles['CustomHeading']))

        if not emotion_log:
            story.append(Paragraph("No engagement data available.", self.styles['CustomNormal']))
            story.append(Spacer(1, 20))
            return

        engagement_counts = {}
        for entry in emotion_log:
            engagement = entry.get("engagement", "unknown")
            engagement_counts[engagement] = engagement_counts.get(engagement, 0) + 1

        total = len(emotion_log)
        engagement_data = [["Engagement State", "Count", "Percentage"]]
        
        for state, count in engagement_counts.items():
            percentage = (count / total) * 100
            engagement_data.append([state.title(), str(count), f"{percentage:.1f}%"])

        table = Table(engagement_data, colWidths=[2.0 * inch, 1.5 * inch, 1.5 * inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#dbeafe')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e3a8a')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e5e7eb')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))

        story.append(table)
        story.append(Spacer(1, 20))

    def _add_social_signals(self, story: List, emotion_log: List):
        """Add social signals section"""
        story.append(Paragraph("Social Signals Detected", self.styles['CustomHeading']))

        if not emotion_log:
            story.append(Paragraph("No social signal data available.", self.styles['CustomNormal']))
            story.append(Spacer(1, 20))
            return

        # Collect all unique signals
        all_signals = {}
        for entry in emotion_log:
            for signal in entry.get("signals", []):
                signal_type = signal.get("type", "unknown")
                all_signals[signal_type] = all_signals.get(signal_type, 0) + 1

        if not all_signals:
            story.append(Paragraph("No social signals were detected during the wake-up cycle.", self.styles['CustomNormal']))
            story.append(Spacer(1, 20))
            return

        signal_data = [["Signal Type", "Occurrences"]]
        for signal_type, count in sorted(all_signals.items(), key=lambda x: x[1], reverse=True):
            signal_data.append([signal_type.title(), str(count)])

        table = Table(signal_data, colWidths=[3.0 * inch, 2.0 * inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#dbeafe')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e3a8a')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e5e7eb')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))

        story.append(table)
        story.append(Spacer(1, 20))

    def _add_quality_metrics(self, story: List, emotion_log: List):
        """Add quality metrics section"""
        story.append(Paragraph("Quality Metrics", self.styles['CustomHeading']))

        quality_entries = [e for e in emotion_log if e.get("quality_index")]
        
        if not quality_entries:
            story.append(Paragraph("No quality metrics available.", self.styles['CustomNormal']))
            story.append(Spacer(1, 20))
            return

        # Calculate averages
        avg_clarity = sum(e.get("clarity", 0) for e in quality_entries) / len(quality_entries)
        avg_authority = sum(e.get("authority", 0) for e in quality_entries) / len(quality_entries)
        avg_energy = sum(e.get("energy", 0) for e in quality_entries) / len(quality_entries)
        avg_rapport = sum(e.get("rapport", 0) for e in quality_entries) / len(quality_entries)
        avg_learning = sum(e.get("learning", 0) for e in quality_entries) / len(quality_entries)

        quality_data = [
            ["Metric", "Average Score"],
            ["Clarity", f"{avg_clarity:.1f}/100"],
            ["Authority", f"{avg_authority:.1f}/100"],
            ["Energy", f"{avg_energy:.1f}/100"],
            ["Rapport", f"{avg_rapport:.1f}/100"],
            ["Learning", f"{avg_learning:.1f}/100"],
        ]

        table = Table(quality_data, colWidths=[2.5 * inch, 2.5 * inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#dbeafe')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e3a8a')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e5e7eb')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))

        story.append(table)
        story.append(Spacer(1, 20))

    def _add_footer(self, story: List):
        """Add footer information"""
        story.append(Spacer(1, 30))
        story.append(Paragraph(
            "This report was generated by RobotHelper - AI-powered wake-up assistant",
            self.styles['CustomSmall']
        ))
        story.append(Paragraph(
            "For questions or support, visit github.com/garavels/robothelper",
            self.styles['CustomSmall']
        ))